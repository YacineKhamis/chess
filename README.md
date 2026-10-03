# Mon manuel d’échecs

Un manuel d’entraînement interactif, découpé en compétences, avec des exercices courts et répétables. Site statique, hébergé gratuitement sur GitHub Pages, sans serveur : tout tourne dans le navigateur.

## Les trois modules

**Quelle est la menace ?** L’adversaire vient de jouer. Tu touches la case où il voudrait jouer ensuite, puis tu joues un coup qui pare la menace. Entraîne directement la question 1 de la checklist. Positions tirées de parties générées et vérifiées par Stockfish (`data/menace.json`).

**Puzzles par thème.** Choisis un thème (fourchette, clouage, pièce en prise, mats…). Les puzzles ratés reviennent jusqu’à ce qu’ils soient réussis, puis de plus en plus espacés.

**Finales de base.** Deux tours, dame ou tour contre roi, depuis une position au hasard, contre Stockfish qui défend au mieux. Le site affiche le mat optimal pour comparer.

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
css/style.css           apparence
js/main.js              accueil et navigation
js/board.js             échiquier (toucher ou glisser)
js/engine.js            pilote du moteur Stockfish
js/util.js              progression, répétition espacée, notation française
js/modules/             un fichier par module
data/                   exercices (JSON)
tools/build_puzzles.py  extraction des puzzles Lichess
vendor/                 chess.js et Stockfish (copies locales)
```

Format d’un puzzle (identique à Lichess) : `fen` est la position avant le coup adverse, `moves` liste les coups en notation UCI ; le premier est joué par l’adversaire, puis on alterne.

## Licences

Stockfish.js : GPL-3 (`vendor/stockfish/COPYING.txt`), donc ce projet est lui aussi distribué sous GPL-3. chess.js : BSD-2. Base de puzzles Lichess : domaine public (CC0). Pièces « cburnett » : CC BY-SA 3.0.
