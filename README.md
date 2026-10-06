# Mon manuel d’échecs

Un manuel d’entraînement interactif, découpé en compétences, avec des exercices courts et répétables. Site statique, hébergé gratuitement sur GitHub Pages, sans serveur : tout tourne dans le navigateur.

## Le parcours d’exercices

Le cœur du site : des exercices qui isolent **une seule idée**, joués jusqu’au bout contre un défenseur parfait, depuis des positions **toujours différentes mais équivalentes** (placement au hasard, miroir, couleurs inversées). À force de répétitions, les motifs apparaissent.

Sept parcours, du plus isolé au plus réaliste :

- **Mats de base** : deux tours, dame, tour, puis les mêmes mats avec des pions bloqués sur l’échiquier (le pat arrive plus vite).
- **Finales de pions** : la règle du carré, le roi devant le pion, l’opposition, les cases clés, tenir la nulle, le pion de la tour.
- **Pièce contre pion** : dame contre pion en 7e (et la défense par le pat), tour contre pion.
- **Finales de tours** : Lucena pour gagner, Philidor pour tenir.
- **Motifs tactiques** : pièce en prise, fourchette, enfilade, clouage, d’abord seuls puis cachés parmi d’autres pièces.
- **Images de mat** : mat du couloir, mat à l’étouffée, batterie dame-fou.
- **Vigilance** : parer la menace adverse avant de jouer son plan (question 1 de la checklist).

Pendant la partie :

- **Indice en trois marches** : l’idée, puis la pièce à jouer, puis le coup avec son explication (« ta tour resserre la boîte : le roi noir passe de 20 à 12 cases »).
- **Verdict immédiat** : un coup qui laisse filer le gain (ou la nulle) arrête la partie ; « Pourquoi ? » montre ton coup, le bon coup et la raison, « Reprendre avant l’erreur » permet de rejouer le moment critique.
- **Référence objective** : le mat ou la promotion le plus rapide possible, calculé exactement par des tables de finales pour les finales à trois pièces.

La progression :

- Chaque exercice a des **paliers** (par exemple : mat en 1 à 3, puis 4 à 7, puis la partie complète). Trois parties propres font monter d’un palier, un échec fait redescendre.
- **Acquis** = 3 parties propres d’affilée au dernier palier, avec les Blancs et les Noirs. **Maîtrisé** = encore propre après une nuit. Ensuite des **contrôles** de plus en plus espacés (1, 3, 7, 14, 30 jours…).
- La **séance du jour** propose les contrôles dus, l’exercice en cours, une nouveauté et un **mélange** d’exercices acquis (sans dire lesquels).

## Les modules d’origine

**Quelle est la menace ?** L’adversaire vient de jouer. Tu touches la case où il voudrait jouer ensuite, puis tu joues un coup qui pare la menace. Positions tirées de parties générées et vérifiées par Stockfish (`data/menace.json`).

**Puzzles par thème.** Choisis un thème (fourchette, clouage, pièce en prise, mats…). Les puzzles ratés reviennent jusqu’à ce qu’ils soient réussis, puis de plus en plus espacés.

L’ancienne page « Finales de base » existe toujours (`#/finales`) : ce sont les trois premiers mats du parcours.

## Mise en ligne (une seule fois)

1. Sur github.com, crée un dépôt **public** (par exemple `manuel-echecs`).
2. Bouton **Add file → Upload files** : glisse tout le contenu de ce dossier (pas le dossier lui-même), y compris les dossiers `.github` et le fichier `.nojekyll`. Valide avec **Commit changes**.
   Sur certains ordinateurs les fichiers commençant par un point sont masqués : affiche les fichiers cachés avant de glisser.
3. **Settings → Pages** : Source = *Deploy from a branch*, Branch = `main`, dossier `/ (root)`, puis **Save**.
4. Une à deux minutes plus tard, le site est en ligne à l’adresse `https://<ton-pseudo>.github.io/manuel-echecs/`.

## Ajouter des milliers de vrais puzzles Lichess

Le dépôt contient une petite sélection de départ. Pour la remplacer par des puzzles de la base ouverte Lichess :

1. Onglet **Actions** du dépôt, puis **Construire les puzzles**, puis **Run workflow**.
2. Garde les réglages par défaut (classement 400 à 1300, 250 puzzles par thème) ou adapte-les.
3. Compter 10 à 20 minutes. L’action écrit `data/puzzles-lichess.json` dans le dépôt, et le site l’utilise automatiquement.

Relance l’action quand tu veux monter la tranche de classement.

## Ta progression

Elle est enregistrée dans le navigateur de l’appareil utilisé. Depuis l’accueil, « Sauvegarder ou transférer ma progression » permet de l’exporter en fichier et de l’importer sur un autre appareil.

## Structure

```
index.html              page unique
css/style.css           apparence (échiquier, modules d’origine)
css/exercices.css       apparence du parcours et de la séance
js/main.js              accueil et navigation
js/board.js             échiquier (toucher ou glisser, promotion, zones, flèches)
js/engine.js            pilote du moteur Stockfish
js/analysis.js          géométrie : cage du roi, opposition, carré du pion, symétries
js/util.js              sauvegarde, notation française
js/progress.js          progression : paliers, acquis, contrôles, séance du jour
js/tb/                  tables de finales exactes (roi + dame, tour ou pion contre roi)
js/drill/               moteur d’exercices : génération, vérification, objectifs, déroulé d’une partie
js/drills/              catalogue : un fichier par parcours
js/explain/             explications des indices et des erreurs
js/modules/             écrans : exercice, parcours, séance, menace, puzzles
data/                   exercices (JSON) et tables de finales (data/tb/*.bin)
tools/build_tb.mjs      construction des tables de finales
tools/build_puzzles.py  extraction des puzzles Lichess
tools/test/             tests (node --test tools/test/)
vendor/                 chess.js et Stockfish (copies locales)
docs/conception-v2.md   conception détaillée du parcours (en anglais)
```

Format d’un puzzle (identique à Lichess) : `fen` est la position avant le coup adverse, `moves` liste les coups en notation UCI ; le premier est joué par l’adversaire, puis on alterne.

## Tests

Node 22 suffit, sans installation : `node --test tools/test/`. `QUICK=1` pour une version rapide, `FULL=1` pour la version complète, `ONLY=<id>` pour un seul exercice. Stockfish tourne dans Node avec la même copie que le site.

## Licences

Stockfish.js : GPL-3 (`vendor/stockfish/COPYING.txt`), donc ce projet est lui aussi distribué sous GPL-3. chess.js : BSD-2. Base de puzzles Lichess : domaine public (CC0). Pièces « cburnett » : CC BY-SA 3.0.
