# PrintCost 3D

Outil de gestion pour vendre ses impressions 3D : coût de revient réel, prix de revente selon le canal, stock de filament, catalogue, ventes et bilan.

Tout tient dans `index.html` : aucun serveur, rien à installer (seule la police d'écriture vient de Google Fonts, avec repli automatique hors ligne). On peut l'ouvrir en double-cliquant dessus ou le servir avec GitHub Pages.

## Écrans

- **Calcul.** Tu choisis ou glisses un fichier n'importe où sur la page.
  - **3MF tranché par Bambu Studio** : le temps, les grammes par couleur AMS, le nombre d'objets et la vignette sont lus directement dans le fichier. Ce sont les chiffres exacts.
  - **STL ou 3MF non tranché** : estimation à partir du volume du modèle (2 parois + dessus/dessous, remplissage et matière au choix, débit moyen en g/h), avec un aperçu 3D. Le modèle est alors marqué « ≈ estimé » dans le catalogue.
  - Chaque couleur est associée à la bobine du stock de même matière et de couleur la plus proche.
  - Le prix reste visible pendant la saisie : à droite sur ordinateur, dans une barre en bas sur téléphone.
- **Catalogue.** Modèles enregistrés avec leur coût, leur prix et le stock de pièces prêtes.
  - « Imprimer » déduit le filament des bobines et ajoute les pièces au stock. Une impression ratée déduit le filament sans rien ajouter au stock.
  - Chaque impression peut être annulée.
- **Ventes.** Chaque vente enregistre la date, le canal, la quantité, le prix, les frais de plateforme (calculés automatiquement) et les frais d'envoi. Le coût de revient est figé au moment de la vente et le stock est décrémenté.
- **Filaments.** Bobines (matière, couleur, prix, poids restant), avec une alerte quand une bobine est presque vide.
- **Bilan.** Chiffre d'affaires et bénéfice du mois et de l'année, détail par mois, par canal et par modèle, coût des impressions ratées, valeur du stock.

## Calcul du coût

Pour un plateau :

| Poste | Formule |
|---|---|
| Filament | grammes × prix de la bobine au kg |
| Électricité | puissance moyenne × durée × prix du kWh |
| Amortissement | prix de la machine ÷ durée d'amortissement × durée |
| Maintenance | € par heure d'impression × durée |
| Risque d'échec | % appliqué aux quatre postes ci-dessus |
| Ton temps | (préparation par plateau + finition × nombre de pièces) × taux horaire |
| Emballage | € par pièce × nombre de pièces |

Coût de revient par pièce = total du plateau ÷ nombre de pièces.
Prix conseillé = coût × (1 + marge), avec un prix minimum et un arrondi au choix (en « ,90 » par défaut).
Prix par canal = prix de vente directe majoré des frais du canal, arrondi aux 10 centimes supérieurs, pour encaisser au moins autant qu'en vente directe.

Le bénéfice affiché est ce qui reste **après** avoir payé ton temps au taux horaire choisi.

## Canaux et frais (valeurs d'octobre 2026, modifiables)

| Canal | Commission | Fixe / commande |
|---|---|---|
| Vente directe, Vinted, Leboncoin, eBay (particulier) | 0 % | 0 € |
| Etsy | 11,64 % (6,5 % transaction + 4 % paiement + 1,14 % frais réglementaires) | 0,48 € (0,30 € paiement + 0,18 € insertion) |
| Whatnot | 10,9 % (8 % + 2,9 % paiement) | 0,30 € |

## Données

**Version en ligne (https://printcost3d-gamma.vercel.app)** : compte unique, données enregistrées dans une base Neon et synchronisées entre appareils. Fonctions serveur dans `api/` (Vercel) :
- `api/auth.js` : création du compte avec le code `SETUP_CODE` (une seule fois), connexion, déconnexion ;
- `api/state.js` : document unique versionné ; en cas de modification simultanée, l'appareil fusionne (corbeille pour les suppressions) puis renvoie ;
- `api/bambu.js` : compte Bambu Lab en lecture seule (accès cloud non officiel) : imprimantes, AMS, historique. Le mot de passe Bambu n'est jamais enregistré, le jeton est chiffré (`BAMBU_KEY`).

Variables Vercel : `DATABASE_URL` (Neon), `SESSION_SECRET`, `BAMBU_KEY`, `SETUP_CODE`.

**Sans serveur** (GitHub Pages, fichier ouvert en local) : tout reste dans le navigateur (`localStorage`, clé `pc3d-v2`), comme avant. Réglages › Exporter / Importer pour déplacer les données.

## Installer sur le téléphone

Sur iPhone, ouvrir le site dans Safari, puis Partager › « Sur l'écran d'accueil ». L'outil s'ouvre alors comme une application, avec son icône.

## Compagnon de tranchage (optionnel)

`slicer_service.py` peut encore trancher un STL avec Bambu Studio en local, mais l'interface ne l'utilise plus : il suffit de déposer le 3MF exporté par Bambu Studio (Fichier › Exporter › Exporter le fichier tranché du plateau).
