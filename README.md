# PrintCost 3D

Application web mobile-first pour estimer le coût réel d'une impression 3D et proposer un prix de vente hors expédition.

## V1 gratuite

- Import STL, G-code et 3MF
- Analyse locale du volume STL
- Extraction de certaines métadonnées G-code
- Profils Bambu Lab P2S + 2 AMS et H2D + 2 AMS
- Coût matière, électricité, amortissement, maintenance et risque d'échec
- Marge, frais de prise en charge et minimum de facturation configurables
- Distinction claire entre coût réel estimé et prix de vente conseillé
- Historique local
- Réglages persistants dans le navigateur

## Valeurs personnelles initiales

- P2S + 2 AMS : 1 000 €
- H2D + 2 AMS : 2 200 €

Ces valeurs sont modifiables dans l'application.

## Calcul du prix conseillé

Le coût réel additionne matière, électricité, amortissement machine, maintenance et risque d'échec. La marge est appliquée à ce coût, puis un forfait fixe de prise en charge est ajouté. Le prix conseillé ne descend jamais sous le minimum de facturation configuré.

Avec les réglages par défaut, une impression PLA de 70 g durant 1 h 50 sur P2S est conseillée à 10 €, hors expédition. Le forfait restant fixe, il ne gonfle pas artificiellement le tarif des grosses impressions.

## Prochaines étapes

1. Moteur de slicing pour STL/3MF afin d'obtenir automatiquement temps et consommation matière.
2. Catalogue d'imprimantes avec profils techniques récupérés/validés automatiquement.
3. Tarifs d'électricité par pays et fournisseur/source avec date de mise à jour.
4. Catalogue de filaments et prix.
5. Comparaison automatique entre imprimantes.
6. PWA installable, comptes et synchronisation cloud.

> Les puissances moyennes présentes dans la V1 sont des estimations de travail et restent modifiables. Elles ne doivent pas être présentées comme des mesures constructeur tant qu'elles ne sont pas sourcées/validées.
