#!/usr/bin/env python3
"""Local Bambu Studio slicing bridge for the static PrintCost 3D UI."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 48921
MAX_UPLOAD = 200 * 1024 * 1024
MATERIALS = {
    "pla": ("Bambu PLA Basic", 1.24),
    "petg": ("Bambu PETG Basic", 1.27),
    "asa": ("Bambu ASA", 1.07),
    "tpu": ("Bambu TPU 95A HF", 1.21),
}
MACHINES = {"p2s": "P2S", "h2d": "H2D"}


def find_bambu() -> Path:
    candidates = [
        os.environ.get("BAMBU_STUDIO_BIN"),
        "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio",
        shutil.which("bambu-studio"),
        shutil.which("BambuStudio"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    raise RuntimeError("Bambu Studio est introuvable. Installe Bambu Studio ou définis BAMBU_STUDIO_BIN.")


def resources_for(binary: Path) -> Path:
    custom = os.environ.get("BAMBU_STUDIO_RESOURCES")
    candidates = [
        Path(custom) if custom else None,
        binary.parent.parent / "Resources",
        binary.parent.parent / "share" / "bambu-studio",
        Path("/usr/share/bambu-studio"),
    ]
    for candidate in candidates:
        if candidate and (candidate / "profiles" / "BBL").is_dir():
            return candidate
    raise RuntimeError("Les profils Bambu Studio sont introuvables. Définis BAMBU_STUDIO_RESOURCES.")


def profile_paths(resources: Path, machine: str, material: str) -> tuple[Path, Path, Path]:
    model = MACHINES.get(machine)
    filament_name = MATERIALS.get(material, MATERIALS["pla"])[0]
    root = resources / "profiles" / "BBL"
    filament = root / "filament" / f"{filament_name} @BBL {model}.json"
    if not filament.is_file():
        filament = root / "filament" / f"{filament_name} @BBL {model} 0.4 nozzle.json"
    paths = (root / "machine" / f"Bambu Lab {model} 0.4 nozzle.json",
             root / "process" / f"0.20mm Standard @BBL {model}.json", filament)
    missing = [str(p) for p in paths if not p.is_file()]
    if missing:
        raise RuntimeError("Profil Bambu absent : " + ", ".join(missing))
    return paths


def parse_gcode(text: str, material: str) -> dict:
    def number(pattern: str):
        match = re.search(pattern, text, re.I | re.M)
        return float(match.group(1)) if match else None

    length = number(r"^;\s*total filament length \[mm\]\s*:\s*([\d.]+)")
    grams = number(r"^;\s*total filament weight \[g\]\s*:\s*([\d.]+)")
    if (not grams or grams <= 0) and length:
        density = MATERIALS.get(material, MATERIALS["pla"])[1]
        grams = length * 3.141592653589793 * (1.75 / 2) ** 2 / 1000 * density
    time_match = re.search(r"total estimated time:\s*([^\r\n;]+)", text, re.I)
    if not time_match:
        time_match = re.search(r"estimated printing time[^=]*=\s*([^\r\n;]+)", text, re.I)
    seconds = 0
    if time_match:
        value = time_match.group(1)
        for amount, unit in re.findall(r"(\d+)\s*([dhms])", value, re.I):
            seconds += int(amount) * {"d": 86400, "h": 3600, "m": 60, "s": 1}[unit.lower()]
    support = bool(re.search(r"^;\s*enable_support\s*=\s*(1|true)\s*$", text, re.I | re.M))
    if not grams or not seconds:
        raise RuntimeError("Le G-code produit ne contient pas les métriques attendues.")
    return {
        "grams": round(grams, 3),
        "filamentLengthMm": round(length or 0, 2),
        "seconds": seconds,
        "hours": round(seconds / 3600, 4),
        "supports": support,
    }


def metrics_in_3mf(path: Path, material: str):
    try:
        with zipfile.ZipFile(path) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith((".gcode", ".gcode.3mf"))]
            if not names:
                return None
            totals = {"grams": 0.0, "filamentLengthMm": 0.0, "seconds": 0, "supports": False}
            for name in names:
                parsed = parse_gcode(archive.read(name).decode("utf-8", "ignore"), material)
                totals["grams"] += parsed["grams"]
                totals["filamentLengthMm"] += parsed["filamentLengthMm"]
                totals["seconds"] += parsed["seconds"]
                totals["supports"] = totals["supports"] or parsed["supports"]
            totals["hours"] = round(totals["seconds"] / 3600, 4)
            totals["source"] = "Métadonnées G-code du 3MF Bambu"
            return totals
    except (zipfile.BadZipFile, KeyError):
        return None


def slice_file(source: Path, machine: str, material: str, supports: bool, infill: int) -> dict:
    embedded = metrics_in_3mf(source, material) if source.suffix.lower() == ".3mf" else None
    if embedded:
        embedded.update({"machine": machine, "material": material})
        return embedded
    binary = find_bambu()
    machine_profile, process_profile, filament_profile = profile_paths(resources_for(binary), machine, material)
    with tempfile.TemporaryDirectory(prefix="printcost3d-") as output:
        base_command = [
            str(binary), "--debug", "2", "--skip-useless-pick", "--min-save",
            "--arrange", "1", "--ensure-on-bed",
        ]
        defaults_command = [
            f"--enable-support={'true' if supports else 'false'}",
            f"--sparse-infill-density={max(0, min(100, infill))}%",
            "--load-settings", f"{machine_profile};{process_profile}",
            "--load-filaments", str(filament_profile),
        ]
        if machine == "h2d":
            defaults_command += [
                # In CLI mode Bambu Studio otherwise treats models crossing the
                # overlap of H2D's two carriage areas as unmappable. Both nozzles
                # can physically cover the shared 325 mm zone used for estimates.
                "--extruder-printable-area=0x0,325x0,325x320,0x320;0x0,325x0,325x320,0x320",
            ]
        ending = ["--slice", "0", "--outputdir", output, str(source)]
        # Preserve embedded Bambu presets for project 3MF files. If they are
        # incomplete, retry with the selected machine's official defaults.
        used_embedded_profiles = source.suffix.lower() == ".3mf"
        command = base_command + ([] if used_embedded_profiles else defaults_command) + ending
        run = subprocess.run(command, capture_output=True, text=True, timeout=600)
        gcodes = list(Path(output).glob("*.gcode"))
        if not gcodes and source.suffix.lower() == ".3mf":
            used_embedded_profiles = False
            run = subprocess.run(base_command + defaults_command + ending, capture_output=True, text=True, timeout=600)
            gcodes = list(Path(output).glob("*.gcode"))
        if not gcodes:
            detail = (run.stderr + "\n" + run.stdout).strip().splitlines()
            raise RuntimeError(detail[-1] if detail else "Bambu Studio n'a produit aucun G-code.")
        totals = {"grams": 0.0, "filamentLengthMm": 0.0, "seconds": 0, "supports": False}
        for gcode in gcodes:
            parsed = parse_gcode(gcode.read_text(errors="ignore"), material)
            for key in ("grams", "filamentLengthMm", "seconds"):
                totals[key] += parsed[key]
            totals["supports"] = totals["supports"] or parsed["supports"]
        totals.update({
            "hours": round(totals["seconds"] / 3600, 4), "machine": machine,
            "material": material,
            "source": ("Bambu Studio · profils intégrés au 3MF" if used_embedded_profiles
                       else f"Bambu Studio · profil {MACHINES[machine]} 0,20 mm"),
        })
        return totals


class Handler(BaseHTTPRequestHandler):
    def send_json_headers(self, status=200):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()

    def reply(self, payload, status=200):
        self.send_json_headers(status)
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode())

    def do_OPTIONS(self):
        self.send_json_headers(204)

    def do_GET(self):
        if self.path != "/health":
            return self.reply({"error": "Introuvable"}, 404)
        try:
            binary = find_bambu()
            self.reply({"ok": True, "engine": str(binary)})
        except RuntimeError as error:
            self.reply({"ok": False, "error": str(error)}, 503)

    def do_POST(self):
        if self.path != "/slice":
            return self.reply({"error": "Introuvable"}, 404)
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_UPLOAD:
            return self.reply({"error": "Fichier trop volumineux (200 Mo maximum)."}, 413)
        try:
            raw = self.rfile.read(length)
            message = BytesParser(policy=policy.default).parsebytes(
                b"Content-Type: " + self.headers.get("Content-Type", "").encode() +
                b"\r\nMIME-Version: 1.0\r\n\r\n" + raw
            )
            fields, upload_name, upload_bytes = {}, "", None
            for part in message.iter_parts():
                name = part.get_param("name", header="content-disposition")
                filename = part.get_filename()
                if filename:
                    upload_name, upload_bytes = filename, part.get_payload(decode=True)
                elif name:
                    fields[name] = part.get_content().strip()
            if upload_bytes is None:
                raise RuntimeError("Aucun fichier reçu.")
            suffix = Path(upload_name).suffix.lower()
            if suffix not in (".stl", ".3mf"):
                raise RuntimeError("Seuls les fichiers STL et 3MF sont acceptés.")
            with tempfile.TemporaryDirectory(prefix="printcost3d-upload-") as folder:
                source = Path(folder) / ("model" + suffix)
                with source.open("wb") as target:
                    target.write(upload_bytes)
                result = slice_file(source, fields.get("machine", "p2s"),
                                    fields.get("material", "pla"),
                                    fields.get("supports", "false") == "true",
                                    int(fields.get("infill", "15")))
            self.reply(result)
        except (RuntimeError, subprocess.TimeoutExpired, ValueError) as error:
            self.reply({"error": str(error)}, 422)

    def log_message(self, fmt, *args):
        print("PrintCost 3D:", fmt % args)


def main():
    parser = argparse.ArgumentParser(description="Compagnon de slicing local PrintCost 3D")
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    print(f"PrintCost 3D prêt sur http://{HOST}:{args.port} — laisse cette fenêtre ouverte.")
    ThreadingHTTPServer((HOST, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
