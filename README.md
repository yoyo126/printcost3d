# PrintCost 3D

Application web mobile-first pour estimer le coût réel d'une impression 3D et proposer un prix de vente hors expédition.

## Calcul automatique réel

- Import STL et 3MF sans saisie manuelle du poids ou du temps
- Slicing réel par le moteur officiel Bambu Studio et ses profils installés
- Lecture directe du G-code embarqué dans les 3MF Bambu déjà tranchés
- Profils Bambu Lab P2S + 2 AMS et H2D + 2 AMS
- Coût matière, électricité, amortissement, maintenance et risque d'échec
- Marge, frais de prise en charge et minimum de facturation configurables
- Distinction claire entre coût réel estimé et prix de vente conseillé
- Historique local
- Réglages persistants dans le navigateur

GitHub Pages héberge l'interface, mais ne peut pas exécuter un moteur natif. Il faut donc lancer le compagnon local sur l'ordinateur où Bambu Studio est installé :

```bash
python3 slicer_service.py
```

Laisser cette fenêtre ouverte, puis utiliser l'application Pages normalement. Le compagnon écoute uniquement sur `127.0.0.1:48921` : les modèles restent sur l'ordinateur et ne sont envoyés à aucun serveur distant. Sur macOS, Bambu Studio est détecté automatiquement dans `/Applications`. Sous Linux, définir au besoin `BAMBU_STUDIO_BIN` et `BAMBU_STUDIO_RESOURCES`.

Pour un STL, l'application utilise les profils officiels 0,4 mm / 0,20 mm P2S ou H2D installés, le matériau, le remplissage et l'activation des supports choisis. Pour un 3MF Bambu déjà tranché, ses métriques et paramètres embarqués sont prioritaires. Un 3MF projet non tranché est confié à Bambu Studio, qui exploite d'abord ses profils internes.

## Valeurs personnelles initiales

- P2S + 2 AMS : 1 000 €
- H2D + 2 AMS : 2 200 €

Ces valeurs sont modifiables dans l'application.

## Calcul du prix conseillé

Le coût réel additionne matière, électricité, amortissement machine, maintenance et risque d'échec. La marge est appliquée à ce coût, puis un forfait fixe de prise en charge est ajouté. Le prix conseillé ne descend jamais sous le minimum de facturation configuré.

Avec les réglages par défaut, une impression PLA de 70 g durant 1 h 50 sur P2S est conseillée à 10 €, hors expédition. Le forfait restant fixe, il ne gonfle pas artificiellement le tarif des grosses impressions.

## Prochaines étapes

1. Catalogue d'imprimantes avec profils techniques récupérés/validés automatiquement.
2. Tarifs d'électricité par pays et fournisseur/source avec date de mise à jour.
3. Catalogue de filaments et prix.
4. Comparaison automatique entre imprimantes.
5. PWA installable, comptes et synchronisation cloud.

> Les puissances moyennes présentes dans la V1 sont des estimations de travail et restent modifiables. Elles ne doivent pas être présentées comme des mesures constructeur tant qu'elles ne sont pas sourcées/validées.
