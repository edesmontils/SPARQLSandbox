# SPARQLSandbox Admin

Application macOS (Python + PySide6) pour administrer les données de plusieurs installations de
SPARQLSandbox (Raspberry Pi, production…) depuis un seul poste.

Elle **ne demande aucune modification des serveurs** : elle agit comme un administrateur qui se
connecte en SSH et édite les mêmes fichiers que vous éditeriez à la main (`donnees/`, `config.xml`,
`sparqlsandbox.ini`, `sparqlsandbox-ia.ini`). Elle utilise le client `ssh` du Mac : votre
`~/.ssh/config` (alias, `ProxyJump`…), vos clés et votre agent SSH sont donc honorés. Aucun mot de
passe n'est mémorisé.

## Fonctions

| Onglet | Ce qu'on y fait |
|---|---|
| **Jeux de données** | créer, supprimer ; modifier titre, référence, description (HTML) et exemples ; **ajouter / remplacer l'ontologie, les instances et les formes SHACL** (syntaxe vérifiée avant envoi), retirer ou télécharger un fichier |
| **Exercices** | ajouter, remplacer, télécharger, supprimer les exercices JSON (format QueryCraft, vérifié) |
| **Sites interrogables** | points d'accès SPARQL autorisés pour `SERVICE` (`services_autorises`), avec raccourcis Wikidata et DBpedia et un test depuis la machine |
| **Réglages** | `sparqlsandbox.ini` : durée de vie des sessions et des copies, plafonds d'espace disque, chemins d'Oxigraph et pyshacl |
| **Correction par IA** | `sparqlsandbox-ia.ini` : URL, clé et modèle de ProxyIAg, quotas ; activation et désactivation |
| **Maintenance** | état des copies de session, purge des copies, rechargement des jeux d'origine, diagnostic de l'installation |

Sécurités : les fichiers écrits le sont de façon atomique (écriture puis `mv`) et en conservant
leurs droits (le fichier de l'IA est créé en `600`) ; avant de **supprimer ou remplacer** un jeu, un
fichier ou un exercice, une copie est gardée sur le Mac dans
`~/Library/Application Support/SPARQLSandboxAdmin/sauvegardes/<machine>/` (bouton « Ouvrir les
sauvegardes » de l'onglet Maintenance). Les suppressions demandent confirmation. L'enregistrement des
réglages relit le fichier distant et ne modifie que les champs du formulaire : commentaires et
réglages voisins sont conservés.

Limite connue : l'enregistrement d'un jeu réécrit son `config.xml` de façon normalisée ; les
commentaires XML qu'il contenait ne sont pas conservés.

## Machines (profils)

« Machines… » ouvre la liste des profils (`profils.json` dans
`~/Library/Application Support/SPARQLSandboxAdmin/`). Un profil indique :

- l'**hôte SSH** (adresse ou alias de `~/.ssh/config`), l'utilisateur, le port, une clé facultative ;
- la **racine du site** (le dossier qui contient `donnees/`) ;
- facultatif : les chemins de `sparqlsandbox.ini`, `sparqlsandbox-ia.ini` et du dossier de travail
  (`sparqlsandbox-tmp`) ; vides, ils sont déduits à côté de la racine du site, comme le fait
  SPARQLSandbox ;
- l'adresse publique du site (pour « Ouvrir le site »).

Le type « Ce Mac (local) » administre une installation locale (`php -S`) sans SSH. Le bouton
« Tester » fait un diagnostic complet (connexion, dossiers, Oxigraph, pyshacl, IA).

La connexion est non interactive (`BatchMode`) : la clé doit être déjà déverrouillée dans l'agent
SSH (`ssh-add --apple-use-keychain ~/.ssh/id_ed25519`), et l'hôte déjà connu ou nouveau
(`StrictHostKeyChecking=accept-new`).

Côté serveur, seuls sont requis un shell POSIX et `cat`, `ls`, `cp`, `mv`, `rm`, `du`, `df` ;
`curl` pour tester un point d'accès.

### Exemple : configurer une machine de production

L'application doit se connecter avec **le compte qui possède le site** (celui qui fait tourner
PHP et qui est propriétaire de `donnees/`, des `.ini` et du dossier de travail), jamais avec
`root` : une erreur ou une compromission n'a alors que les droits du site. Profil type, pour un
site installé sous `/home/sparqlsandbox` :

| Champ | Valeur |
|---|---|
| Hôte SSH | l'adresse ou l'alias de la machine |
| Utilisateur | `sparqlsandbox` (le compte du site, pas `root`) |
| Racine du site | `/home/sparqlsandbox/programmation/SPARQLSandbox` |
| `sparqlsandbox.ini` | `/home/sparqlsandbox/sparqlsandbox.ini` |
| `sparqlsandbox-ia.ini` | `/home/sparqlsandbox/sparqlsandbox-ia.ini` |
| Dossier de travail | `/home/sparqlsandbox/sparqlsandbox-tmp` |
| Adresse publique | l'URL publique du site |

Mise en place sur le serveur, une seule fois (depuis une session `root`, ou avec `sudo`) :

1. **Autoriser votre clé pour le compte du site** (sans doublon : `ssh-copy-id` s'en charge) :
   ```sh
   ssh-copy-id -i ~/.ssh/id_ed25519.pub sparqlsandbox@<hôte>
   ```
   ou, si le compte n'accepte pas encore de connexion, avec `root` :
   ```sh
   cat ~/.ssh/id_ed25519.pub | ssh root@<hôte> 'install -d -m 700 -o sparqlsandbox -g sparqlsandbox /home/sparqlsandbox/.ssh \
     && cat >> /home/sparqlsandbox/.ssh/authorized_keys \
     && chown sparqlsandbox:sparqlsandbox /home/sparqlsandbox/.ssh/authorized_keys \
     && chmod 600 /home/sparqlsandbox/.ssh/authorized_keys'
   ```
   (`>>` ajoute la clé à chaque exécution : ne la lancez qu'une fois, ou dédoublonnez ensuite avec
   `sort -u ~/.ssh/authorized_keys -o ~/.ssh/authorized_keys`.) Vérifiez : `ssh sparqlsandbox@<hôte> id -un`.
2. **Garder une administration possible sans `root`** : le compte du site a un mot de passe
   verrouillé par défaut, donc `sudo` y est inutilisable. Donnez-lui un mot de passe et le droit
   `sudo` (`passwd sparqlsandbox` puis `usermod -aG sudo sparqlsandbox`), ou créez un compte
   d'administration dédié. Évitez `NOPASSWD` : il donnerait `root` à quiconque compromet le compte
   du site. Vérifiez avec `sudo -v` dans une session `sparqlsandbox`.
3. **Interdire la connexion SSH de `root`**, seulement après les deux étapes précédentes, et en
   gardant une session ouverte pour pouvoir annuler :
   ```sh
   cp -p /etc/ssh/sshd_config /etc/ssh/sshd_config.bak
   sed -i -E 's/^\s*PermitRootLogin\s+.*/PermitRootLogin no/' /etc/ssh/sshd_config
   sshd -t && systemctl reload ssh      # (sshd selon la distribution)
   ```
   Contrôle : `ssh root@<hôte>` doit être refusé, `ssh sparqlsandbox@<hôte>` accepté. Pour revenir
   en arrière : restaurer la sauvegarde et recharger `ssh`.
4. Dans l'application, « Machines… » → « Tester » : les sept contrôles du diagnostic doivent être
   verts.

## Lancer

```sh
./admin/lancer.sh                 # crée .venv au premier lancement
```

ou, sans script : `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m sparqlsandbox_admin`
(depuis `admin/`).

## Construire « SPARQLSandbox Admin.app »

```sh
./admin/construire_app.sh         # produit admin/dist/SPARQLSandbox Admin.app
```

L'application n'est pas signée : au premier lancement, clic droit → Ouvrir (ou
`xattr -dr com.apple.quarantine "SPARQLSandbox Admin.app"`).

## Tests

```sh
cd admin && .venv/bin/python -m unittest discover -s tests -t .
```

Les tests couvrent les fichiers `.ini`, les `config.xml` (aller-retour sur les jeux fournis), les
opérations sur les jeux, exercices et copies (sur une installation locale temporaire) et pilotent la
vraie fenêtre hors écran.

## Déploiement du site : ne pas exposer `admin/`

Ce dossier est dans le dépôt de SPARQLSandbox, donc un `git pull` sur un serveur le dépose sous la
racine web. Il ne contient aucun secret, mais il n'a rien à y faire : interdisez-le comme
`donnees`, `tests` et `tmp` (Caddy : ajouter `admin` à la regex déjà utilisée ; Apache : le `.htaccess`
de la racine ne le couvre pas, ajoutez-y un `RedirectMatch 404 ^/.*admin/`, ou n'envoyez pas
`admin/` sur le serveur).
