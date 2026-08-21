import unittest

from slicer_service import parse_gcode


class ParseGcodeTests(unittest.TestCase):
    def test_bambu_metrics_and_density_fallback(self):
        metrics = parse_gcode(
            "; model printing time: 1h 2m 3s; total estimated time: 1h 3m 4s\n"
            "; total filament length [mm] : 1000.00\n"
            "; total filament weight [g] : 0.00\n"
            "; enable_support = 1\n",
            "pla",
        )
        self.assertEqual(metrics["seconds"], 3784)
        self.assertAlmostEqual(metrics["grams"], 2.983, places=3)
        self.assertEqual(metrics["filamentLengthMm"], 1000)
        self.assertTrue(metrics["supports"])

    def test_rejects_incomplete_gcode(self):
        with self.assertRaises(RuntimeError):
            parse_gcode("; nothing useful", "petg")


if __name__ == "__main__":
    unittest.main()
