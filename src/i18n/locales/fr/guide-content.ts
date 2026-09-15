// The written in-app guide — section CONTENT only. Metadata (icons, groups,
// audience, routes) lives in src/modules/guide/sections.ts; GuidePage loads
// this file lazily into the `guide` namespace. Generated from the 2026-09-15
// rewrite; edit by hand from here on (sentence case, **bold** = a UI label).
export default {
  "sections": {
    "welcome": {
      "title": "Bienvenue sur Wiedisync",
      "summary": "À quoi sert l'application, qui l'utilise, en quoi les rôles diffèrent et comment ce guide est organisé.",
      "body": [
        {
          "t": "p",
          "text": "Wiedisync est l'application des membres du KSC Wiedikon. C'est l'endroit unique pour vos matchs, entraînements et événements, vos présences, vos services de marqueur, les finances du club et votre profil personnel — sur votre téléphone ou dans n'importe quel navigateur."
        },
        {
          "t": "note",
          "text": "Gratuite — et l'outil officiel du club. Développée et gérée par le club comme alternative gratuite aux apps payantes de gestion d'équipe ; vous en avez besoin pour vos absences, la gestion des matchs et surtout vos services de marqueur."
        },
        {
          "t": "h",
          "text": "Qui l'utilise"
        },
        {
          "t": "p",
          "text": "Tout le monde utilise la même application ; ce que vous voyez dépend de votre rôle. Les rôles apparaissent sous forme de badges à côté des noms, par exemple **Joueur**, **Coach**, **Resp. équipe** ou **Comité**."
        },
        {
          "t": "ul",
          "items": [
            "Joueurs : vos activités, indiquer si vous venez, absences, services de marqueur, factures et votre profil.",
            "Parents : un seul login pour toute la famille ; une barre en haut indique quel compte vous utilisez et permet de changer (voir la section Ménages et comptes familiaux).",
            "Coachs et responsables d'équipe : gérer l'équipe — effectif, entraînements, événements, matchs, formulaires, sondages, amendes et finances d'équipe. Le groupe **Equipes & coaching** est écrit pour vous.",
            "Capitaines : portent le badge **Capitaine** dans l'effectif et peuvent régler les factures d'équipe sous **Finances → Finances d’équipe**.",
            "Spielplaner : planifient les matchs à domicile du club depuis l'entrée **Planification** du menu (voir la section Planification des matchs).",
            "Comité et finances : finances du club — cotisations, factures, paiements et comptabilité (voir la section Finances du club).",
            "Admins : inscriptions, salles, attribution des marqueurs, communication du club et base de données des membres. **Admin VB** et **Admin BB** couvrent chacun un sport ; les outils **Superadmin** sont réservés à ceux qui gèrent l'application. Les pouvoirs admin ne s'appliquent que lorsque le **Mode admin** est activé dans **Options**."
          ]
        },
        {
          "t": "h",
          "text": "Comment ce guide est organisé"
        },
        {
          "t": "p",
          "text": "Le guide suit ce que vous faites : **Bases** (installation, connexion, navigation, accueil, notifications), **Au quotidien** (calendrier, activités, absences, service de marqueur, équipes, profil), **Argent** (factures, frais, amendes), **Equipes & coaching** et **Admin & planification**. Vous ne voyez que les sections que votre rôle peut utiliser."
        },
        {
          "t": "tip",
          "text": "Ouvrez le guide depuis **Plus → Options → Guide** sur votre téléphone ou via l'icône de chapeau de diplômé à côté de **Options** sur ordinateur ; le bouton ? à côté d'un titre de page ouvre la section de cette page."
        },
        {
          "t": "h",
          "text": "Où trouver de l'aide"
        },
        {
          "t": "p",
          "text": "Quelque chose n'est pas clair ou ne fonctionne pas ? **Options → Feedback** envoie un rapport de bug, une idée de fonctionnalité ou un retour général, avec des captures d'écran (voir la section Feedback, statut et nouveautés). Votre coach ou les admins du club vous aident pour les questions d'équipe et d'adhésion."
        },
        {
          "t": "h",
          "text": "Wiedisync et kscw.ch"
        },
        {
          "t": "p",
          "text": "kscw.ch est le site web public du club : il présente chaque équipe avec son effectif et c'est là que les nouveaux membres s'inscrivent. Wiedisync est l'application réservée aux membres derrière ce site. Les deux partagent les mêmes données ; ce que les visiteurs voient de vous — nom de famille, année de naissance, photo — dépend donc des paramètres de confidentialité de votre profil (voir la section Votre profil)."
        }
      ]
    },
    "install": {
      "title": "Installer l'application",
      "summary": "Mettez Wiedisync sur l'écran d'accueil de votre téléphone et activez les notifications push, appareil par appareil.",
      "body": [
        {
          "t": "p",
          "text": "Wiedisync est une application web : rien à télécharger depuis un app store. Sur un téléphone, vous pouvez l'ajouter à votre écran d'accueil pour qu'elle s'ouvre en plein écran comme une application normale. La page Accueil affiche la bannière **Ajoutez Wiedisync à votre écran d'accueil** jusqu'à ce que vous l'installiez. **Montrez-moi comment** ouvre les étapes pour votre appareil, **Me le rappeler plus tard** masque la bannière jusqu'à la prochaine ouverture du navigateur, et **J'ai compris** la masque définitivement dans ce navigateur. Les étapes se trouvent aussi dans le guide (**Plus → Options → Guide** sur un téléphone, l'icône **Guide** dans la barre supérieure sur un ordinateur) sous **Installer l'application sur votre téléphone**."
        },
        {
          "t": "h",
          "text": "Android"
        },
        {
          "t": "ol",
          "items": [
            "Touchez **Montrez-moi comment** sur la bannière, ou ouvrez la carte du guide. Si votre navigateur propose une installation directe, touchez **Installer** et confirmez.",
            "Sinon, ouvrez le menu du navigateur (⋮ en haut à droite).",
            "Touchez **Installer l'application** ou **Ajouter à l'écran d'accueil**.",
            "Confirmez en touchant **Installer**."
          ]
        },
        {
          "t": "h",
          "text": "iPhone et iPad"
        },
        {
          "t": "ol",
          "items": [
            "Ouvrez la page dans Safari. Les autres navigateurs sur iOS ne peuvent pas ajouter à l'écran d'accueil ; l'application affiche un avis si vous essayez.",
            "Touchez le bouton Partager en bas de Safari.",
            "Faites défiler et touchez **Sur l'écran d'accueil**.",
            "Touchez **Ajouter** en haut à droite."
          ]
        },
        {
          "t": "p",
          "text": "Une fois installée, rouvrir les étapes affiche **Wiedisync est déjà installé sur cet appareil.** Dans l'application installée, **Planification** s'ouvre dans votre navigateur habituel. Sur un ordinateur, rien n'est à installer ; Chrome propose le même bouton **Installer** dans la carte du guide si vous souhaitez une fenêtre séparée."
        },
        {
          "t": "h",
          "text": "Notifications push"
        },
        {
          "t": "p",
          "text": "Le push s'active par appareil : répétez donc l'opération sur chaque téléphone ou ordinateur que vous utilisez. Ouvrez la cloche (ordinateur) ou **Plus → Notifications** (téléphone) et faites défiler jusqu'au bas du panneau. À côté de **Notifications push**, touchez **Activer** ; votre navigateur demande l'autorisation une seule fois. **Desactiver** au même endroit le désactive à nouveau."
        },
        {
          "t": "p",
          "text": "Le push couvre ce qui demande une réaction rapide : les matchs pour lesquels vous êtes convoqué, les entraînements annulés, les rappels pour les activités du lendemain et les délais de réponse, les délais manqués, les actualités du club, les invitations à des événements, les nouveaux formulaires, les amendes, les changements de statut des notes de frais, les changements de statut de licence, les délégations de service de marqueur, les absences saisies pour vous par quelqu'un d'autre, ainsi que les messages qu'un coach ou un responsable d'équipe envoie avec **Contacter** lorsqu'il coche le push. Toucher une notification push ouvre la page correspondante. Les autres changements, comme un match déplacé, n'apparaissent que dans la cloche."
        },
        {
          "t": "note",
          "text": "Si vous avez touché Bloquer dans la demande d'autorisation du navigateur, le panneau affiche **Les notifications push sont bloquees dans les parametres de votre navigateur.** et l'application ne peut plus redemander. Autorisez les notifications pour le site dans les paramètres de votre navigateur ou de votre téléphone, puis touchez **Activer**."
        },
        {
          "t": "tip",
          "text": "S'il n'y a pas de ligne **Notifications push**, votre navigateur ne prend pas en charge le push. Brave sur Android bloque le push, la ligne y est donc masquée ; utilisez Chrome ou Firefox."
        }
      ]
    },
    "account": {
      "title": "Votre compte",
      "summary": "Connexion, activation d'un compte invité, mots de passe, approbation, langue, mode sombre et suppression du compte.",
      "body": [
        {
          "t": "p",
          "text": "Touchez **Se connecter** et saisissez votre **Email** et votre **Mot de passe**. Il n'y a pas de connexion via Google ou Apple. Un lien partagé ouvert sans être connecté se rouvre après votre connexion."
        },
        {
          "t": "h",
          "text": "Obtenir un compte"
        },
        {
          "t": "p",
          "text": "L'inscription se fait uniquement sur invitation ; l'adhésion elle-même se règle sur kscw.ch. Votre coach ou votre responsable d'équipe vous envoie ensuite un lien d'invitation Wiedisync par e-mail, ou vous le montre en personne sous forme de code QR. Ouvrez-le, choisissez votre **Langue**, choisissez et confirmez un mot de passe, puis touchez **Activer le compte**. Vous êtes alors connecté."
        },
        {
          "t": "ul",
          "items": [
            "Un lien ne fonctionne qu'une seule fois et expire après 30 jours ; un ancien lien affiche **Invitation non valide** ou **Invitation déjà utilisée**. Demandez-en un nouveau à votre coach.",
            "Pas d'invitation ? Touchez **S'inscrire**, saisissez l'email que le club a enregistré et touchez **Continuer**. Un membre sans identifiant reçoit un code à 8 chiffres par e-mail, puis complète son nom, ses équipes et son mot de passe.",
            "Un email inconnu affiche **Inscription sur invitation uniquement** ; touchez **Essayer un autre email** ou suivez le lien vers kscw.ch.",
            "Si vous avez demandé une équipe dont vous ne faites pas encore partie, vous voyez **En attente d'approbation** jusqu'à ce que son coach, son responsable d'équipe ou un admin vous approuve ; touchez ensuite **Actualiser le statut**."
          ]
        },
        {
          "t": "note",
          "text": "Les mots de passe doivent comporter au moins 8 caractères, dont une lettre et un chiffre ou un caractère spécial. Les mots de passe très courants sont refusés."
        },
        {
          "t": "h",
          "text": "Mot de passe oublié"
        },
        {
          "t": "ol",
          "items": [
            "Sur la page de connexion, touchez **Mot de passe oublie ?**.",
            "Saisissez votre email et touchez **Envoyer le lien**. Le lien est valable une heure et ouvre le formulaire **Nouveau mot de passe** ; touchez **Enregistrer le mot de passe**.",
            "Vous n'avez jamais eu de mot de passe ? Touchez **Jamais défini de mot de passe ? Utilisez plutôt un code** et saisissez le code à 8 chiffres que vous recevez par e-mail."
          ]
        },
        {
          "t": "note",
          "text": "Une réinitialisation par e-mail ou par code supprime la clé de votre pièce d'identité ; vous devriez alors téléverser à nouveau le document. Si vous connaissez votre mot de passe, utilisez plutôt **Changer le mot de passe** dans **Modifier le profil**, ce qui conserve la clé (voir la section Votre profil)."
        },
        {
          "t": "h",
          "text": "Langue et mode sombre"
        },
        {
          "t": "p",
          "text": "Les deux se trouvent dans **Options** (icône d'engrenage en haut à droite sur ordinateur ; **Plus → Options** sur un téléphone). Le **Mode sombre** est mémorisé par appareil ; l'application démarre en mode sombre. **Langue** (Deutsch, English, Français, Italiano, CH-DE) suit votre navigateur jusqu'à ce que vous fassiez un choix en étant connecté, qui est alors enregistré dans votre profil pour tous vos appareils. Le reste de ce menu est décrit dans la section S'orienter dans l'application."
        },
        {
          "t": "h",
          "text": "Se déconnecter et supprimer son compte"
        },
        {
          "t": "p",
          "text": "**Deconnexion** se trouve dans le menu de l'avatar sur ordinateur et à côté de votre nom dans **Plus** sur un téléphone ; elle supprime aussi la clé de votre pièce d'identité de cet appareil. Pour supprimer votre compte, ouvrez **Mon profil**, faites défiler jusqu'à **Zone dangereuse**, touchez **Supprimer le compte**, saisissez exactement votre adresse email et touchez **Supprimer definitivement le compte**. Cette action est irréversible. Un parent agissant pour un enfant ne peut pas le faire depuis le compte de l'enfant."
        }
      ]
    },
    "navigation": {
      "title": "S'orienter dans l'application",
      "summary": "Où se trouve chaque page sur ordinateur et téléphone, et à quoi servent le menu Options, le sélecteur de sport et les boutons ?.",
      "body": [
        {
          "t": "p",
          "text": "Sur un ordinateur, les pages se trouvent dans des menus déroulants de la barre supérieure. Sur un téléphone, les pages les plus utilisées sont des onglets en bas de l'écran et le reste se trouve derrière **Plus**. Les pages que vous ne pouvez pas utiliser ne sont pas affichées."
        },
        {
          "t": "h",
          "text": "Sur un ordinateur : la barre supérieure"
        },
        {
          "t": "ul",
          "items": [
            "**Accueil** (aussi via le logo).",
            "**Activités** → **Calendrier**, **Matchs et resultats**, **Tableau en direct**, **Entrainements**, **Evenements**.",
            "**Outils membres** → **Equipe** (**Equipes** si vous êtes dans plusieurs équipes ou en mode admin), **Absences**, **Service de marqueur**, **Actualités**, plus **Formulaires** et **Export J+S** si vous entraînez ou dirigez une équipe.",
            "**Finances** → **Finances personnelles**, **Finances d’équipe** et **Finances du club**, selon votre rôle.",
            "**Planification** (Spielplaner, coachs et responsables d'équipe) ouvre l'application de planification ; **Admin** (admins uniquement) se termine par **Tous les outils admin**.",
            "Icônes à droite : cloche (notifications), chapeau de diplômé (**Guide**), engrenage (**Options**), avatar (**Mon profil**, **Deconnexion**)."
          ]
        },
        {
          "t": "h",
          "text": "Sur un téléphone : onglets en bas et Plus"
        },
        {
          "t": "p",
          "text": "La barre inférieure affiche **Accueil**, **Calendrier**, **Matchs**, **Entrainements** et **Plus**. **Plus** contient **Notifications**, **Evenements**, **Outils membres**, **Finances**, **Planification**, **Admin**, votre ligne de profil, **Deconnexion**, la section **Options** ainsi que les liens **Confidentialite** et **Mentions legales**. Un point rouge sur **Plus** signale des notifications non lues ; la ligne **Notifications** indique leur nombre."
        },
        {
          "t": "h",
          "text": "Le menu Options"
        },
        {
          "t": "ul",
          "items": [
            "**Mode sombre** – le mode sombre est activé par défaut ; le choix est mémorisé sur cet appareil.",
            "**Langue** – Deutsch, English, Français, Italiano ou CH-DE. Une fois connecté, elle est enregistrée dans votre profil et vous suit sur vos autres appareils.",
            "**Mode admin** – réservé aux admins et aux membres du comité, voir ci-dessous.",
            "**Feedback**, **Statut** et **Nouveautes** (avec la version actuelle). Sur le téléphone, **Guide** se trouve ici aussi."
          ]
        },
        {
          "t": "h",
          "text": "Sélecteur de sport et boutons ?"
        },
        {
          "t": "p",
          "text": "Si vos équipes couvrent à la fois le volleyball et le basketball, un sélecteur de sport apparaît sur **Accueil** (les icônes de ballon à côté du logo ; le logo affiche tous les sports) et sur **Matchs et resultats** (Volleyball, Basketball, **Tous les sports**, aussi en mode admin). Les membres d'un seul sport voient ce sport et aucun sélecteur. Le choix est mémorisé par membre sur cet appareil."
        },
        {
          "t": "p",
          "text": "À côté du titre de nombreuses pages, un petit bouton **?** ouvre ce guide à la section correspondant à cette page. Le guide complet se trouve sous **Options → Guide** sur le téléphone et derrière l'icône du chapeau de diplômé sur un ordinateur."
        },
        {
          "t": "h",
          "text": "Si vous êtes admin ou membre du comité"
        },
        {
          "t": "p",
          "text": "Le **Mode admin** dans **Options** élargit ce que vous voyez, pas la liste des pages affichées. Tant qu'il est activé, une bannière dorée **Mode admin** s'affiche au-dessus de chaque page sauf l'application de planification, les listes montrent toutes les équipes du club et les pouvoirs admin sur les pages d'équipe sont actifs. Désactivé, vous voyez vos propres équipes comme n'importe quel membre. Il est désactivé par défaut et mémorisé par appareil ; les pages sous **Admin** s'ouvrent dans les deux modes. Les membres du comité sans rôle admin trouvent l'interrupteur uniquement sur le téléphone, sous **Plus → Options** ; il leur donne la même vue à l'échelle du club, en lecture seule."
        }
      ]
    },
    "home": {
      "title": "Accueil",
      "summary": "Ce que montre chaque bloc de la page d'accueil et ce que vous pouvez y faire.",
      "body": [
        {
          "t": "p",
          "text": "**Accueil** est la première page après la connexion : barre supérieure (ordinateur) ou onglets en bas (téléphone). Les cartes n'apparaissent que lorsqu'elles ont du contenu. Si vous jouez à la fois au volleyball et au basketball, un sélecteur de sport en haut filtre les matchs, les résultats et les entraînements ; la page Matchs le suit."
        },
        {
          "t": "h",
          "text": "Les blocs principaux"
        },
        {
          "t": "ul",
          "items": [
            "**Les 7 prochains jours** : un bannière avec les matchs, entraînements, événements, fermetures de salle de vos équipes, vos services de marqueur et les anniversaires de vos coéquipiers.",
            "**Actualites** : les trois dernières nouvelles, annonces épinglées en premier. Toucher une notification la marque comme lue et ouvre l'activité. Une facture ouverte a sa propre ligne au-dessus des actualités. **Tout afficher** ouvre la page Actualités.",
            "**Sondages actifs** : votez aux sondages ouverts de vos équipes.",
            "**Formulaires à remplir** : les formulaires qui vous attendent, avec une échéance **Clôture**. **Remplir** ouvre le formulaire, **Modifier** change vos réponses.",
            "**Vos factures** et **Amendes ouvertes** : uniquement tant que quelque chose est ouvert ; **Tout voir** ouvre la liste complète.",
            "**Classements** (ordinateur uniquement) : les tableaux des ligues de vos équipes, avec un menu déroulant de saison ; une ligne ouvre les classements sur la page Matchs. Tant que Swiss Volley n'a pas publié de données, il affiche **Les données seront communiquées ultérieurement par Swiss Volley**."
          ]
        },
        {
          "t": "h",
          "text": "Mes rendez-vous ou Par catégorie"
        },
        {
          "t": "p",
          "text": "**Mes rendez-vous** est une seule liste triée par date de vos matchs, entraînements, événements et services de marqueur : 10 lignes, **Afficher plus** en ajoute 10. **Par catégorie** les répartit en **Prochains entrainements**, **Evenements**, **Derniers resultats** et **Prochains matchs** ; la puce **Mes equipes** bascule les résultats et les matchs entre vos équipes et tout le club. Touchez une ligne pour l'ouvrir et répondre. La bande à gauche est votre réponse : vert oui, jaune peut-être, rouge non, orange en liste d'attente, gris absent."
        },
        {
          "t": "note",
          "text": "Les services de marqueur apparaissent toujours dans vos rendez-vous et ne peuvent pas être refusés ici ; cédez-en un sur la page Service de marqueur (voir la section Service de marqueur)."
        },
        {
          "t": "h",
          "text": "Les cartes qui demandent votre attention"
        },
        {
          "t": "ul",
          "items": [
            "**Demande de service** (au-dessus de **Actualites**) : quelqu'un veut vous céder un service de marqueur. **Accepter** ou **Refuser**.",
            "**Tu es de service …** (votre rôle, par exemple Marqueur) : affichée de 7 jours avant le match jusqu'à 3 heures après le début ; de 60 minutes avant à 30 minutes après le début, **Urgence : contacter les responsables** révèle le coach et le responsable de l'équipe qui joue et alerte le club.",
            "**Ajoute ton IBAN** / **Confirme ton IBAN** : affichée tant que le club n'a pas un IBAN que vous avez confirmé. **Ajouter l'IBAN** ou **Confirmer dans Finances** ouvre **Factures et remboursements** ; **Plus tard** masque la carte sur cet appareil uniquement."
          ]
        },
        {
          "t": "h",
          "text": "Si vous êtes coach ou responsable d'équipe"
        },
        {
          "t": "p",
          "text": "**Frais d'arbitrage non enregistrés** liste les matchs à domicile de volleyball de vos équipes des 14 derniers jours sans trace de qui a payé les arbitres. **Enregistrer maintenant** ouvre la section **Frais d'arbitrage** du match ; **Plus tard** masque ce match sur cet appareil. La carte disparaît une fois les frais enregistrés (voir la section Finances d'équipe)."
        }
      ]
    },
    "notifications": {
      "title": "Notifications et actualités",
      "summary": "La cloche, la signification de chaque notification, push ou e-mail, le fil Actualités et comment désactiver les e-mails.",
      "body": [
        {
          "t": "p",
          "text": "La cloche dans la barre supérieure sur ordinateur affiche en rouge le nombre de notifications non lues ; sur un téléphone, ouvrez **Plus** → **Notifications** (un point rouge sur **Plus** signale une notification non lue). Le panneau liste vos 30 notifications les plus récentes et se met à jour en direct. Touchez-en une pour la marquer comme lue et ouvrir la page concernée. Utilisez **Tout marquer comme lu**, **Effacer lus** (supprime celles déjà lues) ou l'icône de corbeille sur une ligne."
        },
        {
          "t": "h",
          "text": "Ce que signifient les notifications"
        },
        {
          "t": "ul",
          "items": [
            "**Activite** — un match, un entraînement ou un événement a été créé, déplacé, annulé ou remis au programme, ou vous avez été convoqué.",
            "**A venir** — un rappel la veille d'une activité. **Delai** — un rappel la veille du délai de réponse si vous n'avez pas encore répondu.",
            "**Délai dépassé** — vous n'avez pas répondu à temps et avez été inscrit comme absent, avec une amende si les règles de votre équipe le prévoient (voir la section Amendes).",
            "**Résultat** — un résultat a été saisi pour votre match.",
            "**Service de marqueur** — un service vous a été proposé, ou votre demande a reçu une réponse.",
            "**Note de frais** — votre note de frais a été payée ou refusée. **Amende** — une amende pour vous ou votre équipe a été émise, payée ou annulée.",
            "**Actualités du club** ouvre les Actualités, **Invitation à un événement** l'événement, **Licence** votre profil. Les formulaires ouvrent Formulaires ; une **Demande d'adhésion** (coachs et responsables d'équipe) ouvre la page de l'équipe."
          ]
        },
        {
          "t": "note",
          "text": "Les notifications sont effacées automatiquement : celles qui concernent un match, un entraînement ou un événement le lendemain de celui-ci, toutes les autres après 30 jours."
        },
        {
          "t": "h",
          "text": "Push ou e-mail"
        },
        {
          "t": "p",
          "text": "Chaque notification apparaît dans la cloche ; la plupart sont aussi envoyées en push. Le push est réglé par appareil : dans le panneau, utilisez **Notifications push** → **Activer** sur chaque appareil (voir la section Installer l'application). Seules quelques-unes arrivent aussi par e-mail : les actualités du club et les invitations à un événement lorsque l'expéditeur a choisi de les envoyer par e-mail, les décisions sur les notes de frais, les demandes d'adhésion (coachs et responsables d'équipe) et les nouvelles inscriptions (admins)."
        },
        {
          "t": "h",
          "text": "Le fil Actualités"
        },
        {
          "t": "p",
          "text": "Allez dans **Outils membres** → **Actualités** (sur un téléphone **Plus** → **Outils membres** → **Actualités**). Les actualités du club épinglées viennent en premier, puis les actualités du club et vos notifications, de la plus récente à la plus ancienne ; **Voir plus** en ajoute 20. Vous ne voyez que les publications qui vous sont destinées (tous les membres, votre sport, vos équipes ou vos rôles) ; les publications expirées disparaissent."
        },
        {
          "t": "h",
          "text": "Préférences de notification par e-mail"
        },
        {
          "t": "p",
          "text": "Ouvrez **Mon profil** et cherchez **Notifications par e-mail**. Tout le monde dispose de **Actualités du club** et **Invitations aux événements** ; les coachs et responsables d'équipe ont en plus **Demandes d'adhésion à une équipe** et **Envois de formulaires** ; les admins ont **Nouvelles inscriptions**. Toutes sont activées par défaut. En désactiver une ne coupe que cet e-mail — la cloche continue de l'afficher. Les formulaires n'envoient pas d'e-mail : **Envois de formulaires** coupe à la place le push pour les réponses aux formulaires publics."
        },
        {
          "t": "tip",
          "text": "Pour vous désabonner des e-mails du club, désactivez **Actualités du club** — cela couvre aussi les e-mails groupés envoyés depuis la messagerie du club. Les réinitialisations de mot de passe, les invitations, les e-mails de notes de frais et les messages **Contacter** d'un coach sont toujours envoyés."
        }
      ]
    },
    "calendar": {
      "title": "Calendrier",
      "summary": "Matchs, entraînements, événements, services de marqueur et anniversaires de vos équipes en une vue, avec filtres et export.",
      "body": [
        {
          "t": "p",
          "text": "Le calendrier réunit les matchs, entraînements, événements, fermetures de salle et absences de vos équipes, ainsi que vos services de marqueur et les anniversaires. Ouvrez-le via **Activités → Calendrier** (ordinateur) ou l'onglet **Calendrier** (téléphone). Touchez une entrée pour voir les détails ; pour les entraînements et événements, vous répondez **Oui**, **Peut-etre** ou **Non** directement, et votre propre absence propose **Modifier**. Le sélecteur en haut change de vue :"
        },
        {
          "t": "ul",
          "items": [
            "**Salle** : le plan d'occupation hebdomadaire de la salle. Les coachs et responsables d'équipe y réservent les créneaux libres (voir la section Plan de salle et temps de salle libre).",
            "**Calendrier** : la grille mensuelle ; sur téléphone, une liste par jour que vous touchez pour la déplier. Naviguez avec les flèches ou **Aujourd'hui**. **Filtrer**, **S'abonner** et **Exporter iCal** n'apparaissent que dans cette vue (sous forme d'icônes sur téléphone).",
            "**Matchs** : les matchs proposés et confirmés par équipe, affichés seulement si l'une de vos équipes dispose d'un calendrier de matchs."
          ]
        },
        {
          "t": "h",
          "text": "Filtrer"
        },
        {
          "t": "p",
          "text": "**Filtrer** liste les **Categories** : **Matchs** (**Matchs a domicile**, **Matchs a l'exterieur**, **Mes engagements**), **Activités** (**Entrainements**, **Evenements**), **Salle** (**Halle HW**, **Fermetures**) et **Autre** (**Absences**, **Anniversaires**). Toutes sont activées par défaut. Le sélecteur **Equipe** ne propose que vos propres équipes ; les admins et membres du comité en mode admin peuvent choisir n'importe quelle équipe et démarrent avec toutes les équipes. Les indisponibilités hebdomadaires et les absences non bloquantes restent masquées tant que vous n'activez pas **Afficher les indisponibilités et absences non bloquantes** ; plusieurs absences le même jour se regroupent en une pastille **2 absent(s)**. **Mes engagements** affiche toujours vos propres services de marqueur, quelle que soit l'équipe sélectionnée."
        },
        {
          "t": "h",
          "text": "Signification des couleurs"
        },
        {
          "t": "ul",
          "items": [
            "Bleu foncé : matchs à domicile. Jaune : matchs à l'extérieur. Indigo : vos engagements au marquage.",
            "Vert : entraînements. Violet : événements. Cyan : réservations de salle. Rose : anniversaires. Noir : absences.",
            "Rouge : fermetures de salle ; la journée entière est colorée.",
            "Barré : annulé ; un entraînement supprimé pour un jour de match affiche **Annulé — jour de match** dans ses détails."
          ]
        },
        {
          "t": "h",
          "text": "Anniversaires"
        },
        {
          "t": "p",
          "text": "Les anniversaires sont limités aux équipes : vous ne voyez que les membres des équipes sélectionnées, jamais tout le club. Un membre n'apparaît que s'il a choisi **Afficher la date complete** sous **Visibilite de la date de naissance** dans son profil ; **Annee uniquement** et **Masquer** le laissent hors du calendrier. Touchez un anniversaire pour voir **Fête ses** et le nouvel âge. Un anniversaire le 29 février s'affiche le 28 février les années non bissextiles."
        },
        {
          "t": "h",
          "text": "S'abonner ou exporter"
        },
        {
          "t": "ol",
          "items": [
            "Touchez **S'abonner**, cochez **Entrainements**, **Matchs** et/ou **Evenements**, et réglez si besoin **Filtrer par equipe** (vide = toutes les équipes).",
            "Touchez **Generer le lien d'abonnement** ; le lien est copié. **Copier** répète l'opération, ou utilisez **Ou ouvrir directement dans votre app de calendrier**.",
            "Collez-le dans votre application de calendrier (Google Agenda : Autres agendas → À partir de l'URL ; Apple Calendrier : Fichier → Nouvel abonnement à un calendrier). Il se met à jour tout seul et inclut toujours vos engagements au marquage.",
            "**Exporter iCal** télécharge à la place ce qui est à l'écran sous forme de fichier ; le bouton est grisé tant que la vue est vide."
          ]
        },
        {
          "t": "note",
          "text": "Le lien d'abonnement est personnel (il contient un jeton qui ajoute vos services de marqueur) : gardez-le privé. Un fichier exporté est un instantané et ne se met jamais à jour."
        }
      ]
    },
    "games": {
      "title": "Matchs et résultats",
      "summary": "Calendrier, résultats, classements et tableau en direct, et comment indiquer si vous jouez.",
      "body": [
        {
          "t": "p",
          "text": "Ouvrez **Activités → Matchs et resultats** sur ordinateur ou l'onglet **Matchs** sur votre téléphone. Tout le monde peut consulter ; répondre nécessite une connexion. Si vous pratiquez les deux sports, basculez avec **Volleyball** / **Basketball** / **Tous les sports** ; les puces d'équipe filtrent par équipe."
        },
        {
          "t": "h",
          "text": "Les onglets"
        },
        {
          "t": "ul",
          "items": [
            "**A venir** : vos prochains matchs sous forme de cartes, répartis en **Championnat** et **Coupe**, avec l'**Heure de rassemblement** et les barres de réponses (vert oui, jaune peut-être, rouge non).",
            "**Resultats** : les matchs terminés avec le score par set. Les résultats et les classements arrivent des fédérations chaque matin.",
            "**Classements** : choisissez une **Saison**, touchez une ligne pour voir les matchs de cette équipe et, pour le volleyball, touchez la cellule **V** ou **D** pour la répartition 3:0/3:1 contre 3:2. Tant qu'une saison n'est pas publiée, vous voyez **Les données seront communiquées ultérieurement par Swiss Volley**.",
            "**Tableau d'honneur** : statistiques des équipes de tout le club, en **Absolu** ou **Par match**."
          ]
        },
        {
          "t": "h",
          "text": "Indiquer si vous jouez"
        },
        {
          "t": "p",
          "text": "Sur une carte, touchez **Oui**, **Peut-etre** ou **Non** et, si vous le souhaitez, **Ajouter une note...** ; dans le détail du match, les mêmes boutons se trouvent sous **Present ?**."
        },
        {
          "t": "ul",
          "items": [
            "Votre coach peut fixer un délai **Repondre avant le** ; si vous n'avez pas répondu, vous recevez un rappel la veille du délai. Passé ce délai, votre réponse est verrouillée (**Delai depasse**). Avec une règle d'amende pour inscription tardive, les personnes sans réponse sont marquées comme absentes et sanctionnées (voir la section Amendes).",
            "Une absence enregistrée vous désinscrit automatiquement (**Absent**, ou **Indisponible** pour une indisponibilité hebdomadaire). Toucher une réponse remplace ce statut.",
            "Les joueurs invités ne peuvent pas répondre pour les matchs de leur équipe d'accueil. Si un coach vous convoque, vous êtes averti, le match apparaît sur l'accueil et dans votre calendrier, et vous pouvez répondre.",
            "Avec l'**Inscription automatique** pour les matchs dans votre profil, les matchs nouveaux et sans réponse démarrent en **Oui** ; certaines équipes préconfirment tous les membres titulaires (**Confirmer automatiquement les matchs**)."
          ]
        },
        {
          "t": "tip",
          "text": "**Voir l'effectif** liste qui a répondu ; les cartes affichent **Entraineur present** dès qu'un coach a confirmé et avertissent **ATTENTION: Équipe incomplète** en dessous du minimum."
        },
        {
          "t": "h",
          "text": "Détail du match, partage et scores en direct"
        },
        {
          "t": "p",
          "text": "Touchez une carte pour ouvrir le match : **Infos du match**, **Lieu** avec un lien vers la carte, **Arbitres**, le score par set une fois joué, et **Marqueur(s)** ou **Officiels** indiquant qui est de service (voir la section Service de marqueur). **Partager le lien** copie un lien ou ouvre la feuille de partage de votre téléphone ; les destinataires doivent se connecter et voient **Ce lien n'est plus disponible pour toi** s'ils ne sont pas autorisés à consulter le match."
        },
        {
          "t": "p",
          "text": "Pendant un match dont le score est saisi dans la salle, une bannière rouge **En direct** apparaît en haut de la page Matchs ; touchez **Regarder** pour le suivre point par point (sur ordinateur aussi sous **Activités → Tableau en direct**). Aucune connexion nécessaire."
        },
        {
          "t": "h",
          "text": "Si vous êtes coach ou responsable d'équipe"
        },
        {
          "t": "p",
          "text": "Vous disposez en plus de l'onglet **Tableau de bord coach** et pouvez modifier les réponses, convoquer des joueurs, fixer le délai et l'heure de rassemblement, annuler un match, contacter l'équipe et enregistrer les **Frais d'arbitrage** pour les matchs de volleyball à domicile — voir la section Gérer entraînements, matchs et événements."
        }
      ]
    },
    "trainings": {
      "title": "Entraînements",
      "summary": "Les entraînements de votre équipe : répondre Oui, Peut-être ou Non, délais, et ce que l'application modifie d'elle-même.",
      "body": [
        {
          "t": "p",
          "text": "Ouvrez **Activités → Entrainements** sur ordinateur ou l'onglet **Entrainements** sur votre téléphone. Chaque carte affiche la date, l'heure, la salle, le coach et les notes, ainsi que des badges : **Essai** (ouvert aux nouveaux venus), **Raccourci** (un match à domicile suit dans la même salle) et **Annule**. Le filtre d'équipe permet de changer d'équipe ; **Afficher anciens entraînements** fait apparaître les dates passées."
        },
        {
          "t": "h",
          "text": "Répondre"
        },
        {
          "t": "ul",
          "items": [
            "Touchez **Oui**, **Peut-etre** ou **Non**. Un champ de note apparaît une fois que vous avez répondu ; Entrée ou la coche l'enregistre.",
            "**Repondre avant le** indique le délai. Ensuite, vous voyez **Delai depasse** en rouge et votre réponse est verrouillée.",
            "Certains entraînements exigent une raison pour **Peut-etre** ou **Non** : ouvert depuis l'accueil ou un lien partagé, l'entraînement n'enregistre pas votre réponse sans raison (**Veuillez fournir une raison**).",
            "Les niveaux d'invités exclus voient **Votre niveau d'invité est exclu de cet entraînement** à la place des boutons.",
            "L'icône de personnes ouvre **Participation** : qui a répondu quoi."
          ]
        },
        {
          "t": "h",
          "text": "Ce qui se passe automatiquement"
        },
        {
          "t": "ul",
          "items": [
            "**Inscription automatique** : touchez votre avatar → **Mon profil** (téléphone : **Plus** → votre nom) et activez **Inscription automatique** pour **Entraînements**. Les entraînements nouveaux et sans réponse démarrent alors en **Oui** ; les réponses que vous avez déjà données ne sont jamais modifiées.",
            "Une absence vous décline automatiquement ; la carte affiche **Absent** (ou **Indisponible** pour une indisponibilité hebdomadaire). Toucher une réponse la remplace. Voir la section Absences.",
            "Vous recevez un rappel la veille du délai si vous n'avez pas répondu, puis à nouveau la veille de l'entraînement.",
            "Si votre équipe applique une règle d'amende pour inscription tardive, manquer le délai vous marque comme absent et peut vous coûter une amende. Voir la section Amendes.",
            "Si **Refuser automatiquement les « Peut-être »** est activé pour votre équipe, **Peut-etre** devient **Non** après le délai."
          ]
        },
        {
          "t": "h",
          "text": "Annulations et matchs"
        },
        {
          "t": "ul",
          "items": [
            "Un entraînement annulé reste affiché, grisé, avec le motif en rouge ; l'équipe est informée.",
            "Si **Annulation automatique** est configurée, un entraînement est annulé dès que le délai passe avec moins de joueurs confirmés que le minimum.",
            "Le jour où votre équipe a un match, à domicile ou à l'extérieur, son entraînement est annulé automatiquement (**Annulé — jour de match** dans le calendrier).",
            "Si une autre équipe a ensuite un match à domicile dans votre salle (dès 45 minutes avant le début), votre entraînement se termine plus tôt (**Se termine plus tôt — match à domicile dans la salle ensuite**) ou est annulé lorsque le match le recouvre entièrement.",
            "Si vous jouez dans deux équipes et que l'une a un match, vous êtes mis en **Non** pour l'entraînement de l'autre équipe ce jour-là (note `Game <équipe>`) ; une réponse que vous avez donnée vous-même n'est jamais écrasée.",
            "Lorsque le match est déplacé ou annulé, l'entraînement et les refus automatiques sont rétablis."
          ]
        },
        {
          "t": "note",
          "text": "Les annulations pour jour de match à plus de 14 jours se font en silence ; vérifiez le calendrier avant une semaine de match."
        },
        {
          "t": "h",
          "text": "Si vous êtes coach ou responsable d'équipe"
        },
        {
          "t": "p",
          "text": "La création, la modification et l'annulation d'entraînements ainsi que le tableau des présences du **Tableau de bord entraineur** sont décrits dans la section Gérer entraînements, matchs et événements."
        }
      ]
    },
    "events": {
      "title": "Événements",
      "summary": "Événements du club et des équipes : qui est invité, réponse par jour, délais, joueurs invités et personnes sans compte.",
      "body": [
        {
          "t": "p",
          "text": "Les événements regroupent tout ce qui n'est ni un match ni un entraînement : tournois, soirées, réunions, week-ends d'entraînement. Ouvrez **Activités → Evenements** sur ordinateur ou **Plus → Evenements** sur votre téléphone. **Passés** affiche les événements antérieurs ; un sélecteur d'équipe apparaît si vous faites partie de plusieurs équipes."
        },
        {
          "t": "h",
          "text": "Qui voit un événement"
        },
        {
          "t": "ul",
          "items": [
            "Les événements à l'échelle du club n'ont ni équipe, ni rôle, ni personne nommée associés et sont visibles par tous les membres.",
            "Les événements d'équipe affichent les équipes invitées sous forme de puces ; leurs joueurs et leur staff les voient.",
            "Un badge **Événement ciblé** signifie que des rôles précis ou des personnes nommées ont été invités.",
            "Vos propres services de marqueur apparaissent sous forme de cartes ambrées **De service** (voir la section Service de marqueur)."
          ]
        },
        {
          "t": "h",
          "text": "Répondre"
        },
        {
          "t": "p",
          "text": "Touchez **Oui**, **Peut-etre** ou **Non** sur la carte ou dans le détail de l'événement. La bande colorée à gauche est votre réponse, les barres comptent les réponses et l'icône de personnes (**Voir la liste**) montre qui a répondu. **Peut-etre** peut être désactivé pour un événement. Après avoir répondu, vous pouvez laisser un commentaire sous **Ajouter une note...** ; pour certains événements, un motif est obligatoire lorsque vous déclinez ou répondez **Peut-etre**."
        },
        {
          "t": "ul",
          "items": [
            "**Repondre avant le** indique le délai. Une fois dépassé, votre réponse est verrouillée et **Delai depasse** s'affiche en rouge.",
            "Une absence couvrant l'événement vous décline automatiquement et affiche **Absent** ; touchez une réponse pour la remplacer.",
            "**Inscription automatique** → **Événements** sous **Mon profil** fait que les nouveaux événements démarrent comme confirmés pour vous.",
            "Pour les événements d'équipe, vous recevez une notification de rappel la veille de l'événement.",
            "Certains événements demandent trois **Preferences de poste** dans le détail de l'événement lorsque vous confirmez ; les trois sont obligatoires."
          ]
        },
        {
          "t": "h",
          "text": "Événements sur plusieurs jours"
        },
        {
          "t": "p",
          "text": "Pour un événement sur plusieurs jours, **Oui**, **Peut-etre** ou **Non** sur la carte répond pour tous les jours à la fois. **Par jour** sur la carte, ou **Participation par creneau** dans le détail de l'événement, vous permet de cocher ou décocher chaque jour séparément. Les réponses mixtes s'affichent sous forme de compte, par exemple 2/3 confirmés."
        },
        {
          "t": "h",
          "text": "Joueurs invités et personnes sans compte"
        },
        {
          "t": "ul",
          "items": [
            "Si seul le cadre principal a été invité, les joueurs invités (G1–G3) voient l'événement mais ne peuvent pas répondre ; la carte indique **Les joueur·euses invite·es ne sont pas convie·es a cet evenement**. Une invitation personnelle prime sur cette règle.",
            "Si l'événement dispose d'un formulaire pour les personnes externes, le détail de l'événement affiche **Lien d'inscription pour les invités** (**Copier** / **Ouvrir**). Ces inscriptions ne figurent pas sur la liste ; les admins les voient sous **Toutes les inscriptions**.",
            "Si vous ouvrez un lien d'inscription public alors que vous êtes connecté, touchez **Ouvrir l'événement** et répondez dans l'application, afin de compter sur la liste."
          ]
        },
        {
          "t": "h",
          "text": "Si vous êtes coach ou responsable d'équipe"
        },
        {
          "t": "p",
          "text": "Créer, modifier et annuler des événements ainsi que le lien d'inscription public : voir la section Gérer entraînements, matchs et événements. Dans la liste, vous pouvez modifier les réponses de vos joueurs ; dans le détail de l'événement, le compteur **Invites** à côté de votre propre réponse ajoute les personnes supplémentaires que vous amenez."
        }
      ]
    },
    "absences": {
      "title": "Absences",
      "summary": "Signalez au club vos périodes d'absence pour que les activités et la planification des matchs en tiennent compte.",
      "body": [
        {
          "t": "p",
          "text": "Ouvrez **Outils membres → Absences** (ordinateur) ou **Plus → Outils membres → Absences** (téléphone). La page comporte deux vues, **Absences** et **Hebdomadaires**, ainsi qu'un sélecteur **Les miennes** / **Équipe** si vous faites partie d'une équipe. **Équipe** affiche les absences de vos coéquipiers ; pour les outils du coach à cet endroit, voir la section Absences et blocages d'équipe."
        },
        {
          "t": "h",
          "text": "Ajouter une absence"
        },
        {
          "t": "ol",
          "items": [
            "Touchez **Nouvelle absence**.",
            "Indiquez **Du** et **Au**, ou cochez **Indefini** s'il n'y a pas encore de date de fin.",
            "Choisissez un **Motif** (**Blessure**, **Vacances**, **Travail**, **Personnel** ou **Autre**) et ajoutez des **Details (optionnel)**.",
            "Sous **Concerne**, laissez **Tout** ou sélectionnez uniquement **Entrainements**, **Matchs** ou **Evenements**.",
            "Laissez **Bloque la planification des matchs** activé, sauf si vous ne joueriez de toute façon pas (voir ci-dessous), puis **Enregistrer**."
          ]
        },
        {
          "t": "p",
          "text": "Utilisez **Modifier** et **Supprimer** sur une ligne pour la changer ou la retirer. Les absences passées se trouvent sous **Afficher les absences passees**. Pour en saisir plusieurs à la fois, touchez **Importer** : **Telecharger le modele**, remplissez les dates (dd.mm.yyyy), le motif et ce que chaque absence concerne, téléversez le fichier, vérifiez l'**Apercu** et confirmez avec **Importer**. Les absences importées bloquent la planification des matchs."
        },
        {
          "t": "h",
          "text": "Indisponibilité hebdomadaire"
        },
        {
          "t": "p",
          "text": "Pour un conflit récurrent, passez à **Hebdomadaires** et touchez **Nouvelle hebdomadaire**. Choisissez les **Jours de la semaine**, ce que cela **Concerne**, une date **Du**, éventuellement une date **Au** (elle est **Indefini** par défaut) et une **Note (optionnel)**. Les indisponibilités hebdomadaires n'influencent jamais la planification des matchs."
        },
        {
          "t": "h",
          "text": "Ce qui se passe automatiquement"
        },
        {
          "t": "ul",
          "items": [
            "Votre réponse à chaque entraînement, match ou événement à venir couvert par l'absence passe à « refusé », avec votre motif en note, et l'activité affiche **Absent** (ou **Indisponible** pour une hebdomadaire). Les activités passées ne sont pas modifiées.",
            "Vous pouvez toujours changer votre réponse sur une activité couverte. Une réponse manuelle est conservée même si l'absence est modifiée ou supprimée plus tard.",
            "Si vous supprimez une absence, les refus qu'elle a créés disparaissent et les réponses qu'elle avait remplacées redeviennent confirmées.",
            "Les activités couvertes par une absence comptent comme excusées dans vos statistiques de présence.",
            "Vos coéquipiers, votre coach et votre responsable d'équipe voient vos absences, y compris le motif et les détails. Dans le calendrier, elles apparaissent sous le filtre **Absences** (voir la section Calendrier)."
          ]
        },
        {
          "t": "h",
          "text": "Absences et planification des matchs"
        },
        {
          "t": "p",
          "text": "Avec **Bloque la planification des matchs** activé, le Spielplaner considère vos dates comme indisponibles lorsqu'il place les matchs de votre équipe : les dates où quelqu'un est absent sont évitées, et une date avec trois joueurs absents ou plus n'est jamais utilisée. Seules les absences ponctuelles qui concernent **Matchs** ou **Tout** comptent ; les indisponibilités hebdomadaires et les absences des joueurs invités ne comptent pas. Désactivez-le en cas de blessure de longue durée ou de congé maternité, sinon votre équipe ne pourra pas être planifiée pendant des mois."
        },
        {
          "t": "note",
          "text": "Si un coach, un responsable d'équipe ou un admin ajoute ou modifie une absence pour vous, vous recevez une notification et la ligne indique qui l'a modifiée et quand. Toute note laissée par cette personne vous est visible."
        }
      ]
    },
    "scorer": {
      "title": "Service de marqueur",
      "summary": "Vos services de marqueur, de tableau d'affichage et d'arbitre lors des matchs à domicile : inscription, délégation, rappels et urgences.",
      "body": [
        {
          "t": "p",
          "text": "Chaque match à domicile a besoin d'officiels : un **Marqueur**, un opérateur de **Tableau d'affichage** (ou un seul **Marqueur/Tableau** combiné) et parfois un **Arbitre** ; en basketball un **Marqueur (OTR1)**, un **Chronometreur (OTR1)** et un **Officiel 24\" (OTR2)**. Ouvrez **Outils membres → Service de marqueur** (ordinateur) ou **Plus → Outils membres → Service de marqueur** (téléphone)."
        },
        {
          "t": "h",
          "text": "Ce que vous voyez"
        },
        {
          "t": "ul",
          "items": [
            "**Matchs** liste les prochains matchs à domicile pour lesquels votre équipe assure un service ou pour lesquels vous êtes attribué.",
            "Un match est **Confirme** dès que chaque service a une personne ; jusque-là, il est **Ouvert**. Au sein d'une même journée, les matchs ouverts apparaissent en premier.",
            "**Tous** affiche les matchs de vos équipes, **Sélectionnés** uniquement ceux qui vous sont attribués. **Filtres** restreint par **Date**, **Équipe qui joue**, **Equipe de service**, **Type de service** ou **Service non attribue** ; **Afficher les anciens matchs** ajoute les matchs passés de la saison en cours.",
            "**Vue d'ensemble** compte les services et les places ouvertes **Par équipe de service** ou **Par match**."
          ]
        },
        {
          "t": "h",
          "text": "Prendre un service"
        },
        {
          "t": "ol",
          "items": [
            "Touchez **M'inscrire** sur un service ouvert de votre équipe. Le bouton n'apparaît que si vous détenez la licence requise : une licence de marqueur pour un **Marqueur** en volleyball, OTR1 pour les services de basketball (OTR2 ou OTN pour **Officiel 24\" (OTR2)**) ; **Marqueur/Tableau**, **Tableau d'affichage** et **Arbitre** n'en exigent aucune.",
            "Vérifiez le rôle, le match, la date et la règle d'arrivée dans **Confirmer l'attribution**, puis touchez **Confirmer**. Une absence à cette date affiche un avertissement, mais ne vous empêche pas de continuer."
          ]
        },
        {
          "t": "note",
          "text": "Un service que vous prenez est définitif : vous ne pouvez pas l'abandonner, seulement le déléguer. Soyez dans la salle 30 minutes à l'avance comme marqueur, marqueur/tableau ou arbitre, 15 minutes comme opérateur du tableau d'affichage ou pour tout service de basketball. Un retard ou une absence entraîne une amende de CHF 50.00."
        },
        {
          "t": "h",
          "text": "Déléguer un service"
        },
        {
          "t": "p",
          "text": "Touchez **Deleguer** à côté de votre nom, choisissez un membre dans **Votre equipe** ou **Autres membres** et confirmez avec **Deleguer**. Rien ne change tant que la personne n'a pas touché **Accepter** dans la bannière **Demande de service** de sa page Service de marqueur ; vous voyez la demande comme en attente et vous êtes informé de sa réponse. Le destinataire doit détenir la licence du service. Les demandes concernant des matchs déjà joués expirent automatiquement."
        },
        {
          "t": "h",
          "text": "Rappels et urgences"
        },
        {
          "t": "ul",
          "items": [
            "À partir d'une semaine avant le match, la page d'accueil affiche une bannière jaune avec votre service.",
            "À partir de 60 minutes avant le début, **Urgence : contacter les responsables** révèle le coach et le responsable de l'équipe qui joue et alerte le club.",
            "**Ajouter au calendrier** sur une carte de match télécharge le service ; un lien personnel **S'abonner** depuis la page Calendrier inclut toujours vos services (voir la section Calendrier).",
            "En tant que marqueur attribué, vous pouvez ouvrir **Composition** à partir de 40 minutes avant le match pour voir la liste de l'équipe à domicile."
          ]
        },
        {
          "t": "h",
          "text": "Si vous êtes admin"
        },
        {
          "t": "p",
          "text": "En tant qu'admin du sport avec le mode admin activé, vous voyez tous les matchs à domicile et définissez **Selectionner l'equipe** et **Selectionner la personne** sur chaque service jusqu'au début du match. La planification de la saison se fait sous **Admin → Opérations de match → Attribution des marqueurs** (voir la section Attribuer les services de marqueur)."
        }
      ]
    },
    "teams": {
      "title": "Équipes",
      "summary": "Vos cartes d'équipe, l'effectif et les profils des joueurs, et comment rejoindre ou quitter une équipe.",
      "body": [
        {
          "t": "p",
          "text": "Ouvrez **Outils membres → Equipe** sur ordinateur (**Equipes** dès que vous figurez dans plus d'un effectif) ou **Plus → Outils membres → Equipes** sur un téléphone. La page **Equipes et membres** affiche la saison en cours (**Saison 2026/27**) ; les saisons changent le 1er juin."
        },
        {
          "t": "h",
          "text": "Cartes d'équipe"
        },
        {
          "t": "ul",
          "items": [
            "Une carte par équipe dans laquelle vous jouez, que vous entraînez ou dont vous êtes responsable, regroupées par sport.",
            "Une carte affiche la ligue, la saison, le nombre de joueurs et d'invités, par-dessus la photo d'équipe.",
            "Touchez une carte pour ouvrir l'équipe."
          ]
        },
        {
          "t": "h",
          "text": "La page d'équipe"
        },
        {
          "t": "ul",
          "items": [
            "**Staff** liste les coachs et les responsables d'équipe.",
            "**Effectif actuel** est un tableau avec les colonnes **#**, **Poste** et **Role** (Coach, Capitaine, Resp. équipe). Touchez un en-tête de colonne pour trier.",
            "**Invités** liste les joueurs avec un niveau d'invité I1 à I3 ; le niveau 1 a la priorité la plus élevée lorsque les entraînements sont complets, le niveau 3 la plus basse.",
            "Sous l'effectif : le calendrier de l'équipe (matchs, entraînements, événements, fermetures de salle), les dates de match encore en négociation, les sondages s'ils sont activés pour l'équipe, et les **Sponsors**."
          ]
        },
        {
          "t": "h",
          "text": "Profil du joueur"
        },
        {
          "t": "p",
          "text": "Touchez un nom dans un effectif pour ouvrir le profil du joueur : photo, rôles, postes, équipes, **Statistiques** pour la saison en cours (**Entrainements**, **Matchs**, **Taux de presence**) et **Absences en cours**. La présence compte les réponses confirmées du 1er juin à aujourd'hui, sans les activités couvertes par une absence. L'e-mail, le téléphone et l'âge ne sont visibles que par les coachs et responsables des équipes du joueur (ou par un admin de sport en mode admin), et seulement s'ils ne sont pas masqués dans le profil (voir la section Votre profil)."
        },
        {
          "t": "h",
          "text": "Rejoindre et quitter une équipe"
        },
        {
          "t": "ol",
          "items": [
            "Sur la page Equipes, touchez **Gérer les équipes** (un bouton plus sur téléphone) ou **Ajouter une equipe** dans votre profil. Si vous n'avez encore aucune équipe, le bouton s'appelle **Rejoindre une nouvelle équipe**.",
            "Sous **Rejoindre une equipe**, choisissez le sport si demandé, sélectionnez une équipe et touchez **Envoyer la demande**. Les équipes dont vous faites déjà partie ou que vous avez déjà demandées, ainsi que les équipes de l'autre genre, ne sont pas proposées.",
            "Chaque coach et responsable de cette équipe est averti (dans l'application et par e-mail) et peut approuver ou rejeter la demande. En attendant, votre profil affiche la demande comme **En attente d'approbation** ; le X à côté la retire.",
            "Pour quitter une équipe, touchez **Quitter l'équipe** dans la même fenêtre (ou le X sur la puce de l'équipe dans votre profil) et confirmez."
          ]
        },
        {
          "t": "note",
          "text": "Quitter une équipe vous retire immédiatement de l'effectif. Pour la rejoindre à nouveau, il vous faut de nouveau l'approbation d'un coach."
        },
        {
          "t": "h",
          "text": "Si vous êtes coach ou responsable d'équipe"
        },
        {
          "t": "p",
          "text": "Sur un grand écran, votre page d'équipe affiche aussi les colonnes **Email**, **Telephone** et **Date de naissance** (les paramètres de confidentialité s'appliquent toujours). Un encadré ambre **2 demande(s) en attente** propose **Approuver** et **Rejeter** ; pour une demande d'adhésion, choisissez d'abord **Rejoindre en tant que :** **Joueur/euse** ou **Invité·e** niveau 1 à 3. **Modifier l'equipe** ouvre l'éditeur d'effectif. Rejeter la demande d'un nouveau compte désactive l'adhésion et l'accès à l'application de cette personne. Le reste se trouve dans la section Éditeur d'effectif."
        }
      ]
    },
    "profile": {
      "title": "Votre profil",
      "summary": "Vos coordonnées, photo, réglages de confidentialité, inscription automatique, e-mails, IBAN, documents et statut de licence.",
      "body": [
        {
          "t": "p",
          "text": "Ouvrez **Mon profil** depuis votre avatar (ordinateur) ou via **Plus** → votre nom (téléphone). Vous y trouvez vos équipes, vos coordonnées, vos licences, vos absences et vos amendes ; **Modifier le profil** ouvre le formulaire."
        },
        {
          "t": "h",
          "text": "Modifier vos données"
        },
        {
          "t": "ul",
          "items": [
            "**Changer la photo** (JPEG, PNG, WebP ou GIF ; les photos sont réduites automatiquement, max. 5 Mo). **Visibilité sur le site web**, juste à côté, affiche la photo sur l'effectif de kscw.ch.",
            "**Surnom** remplace votre prénom dans toute l'application.",
            "**Numero** (0–99) doit être libre dans vos équipes actives.",
            "**Données personnelles (ClubDesk)** contient l'adresse, la nationalité, **Formation d'entraîneur**, **Numéro d'AVS** et **IBAN**. Saisissez votre IBAN pour les remboursements ; cela fait aussi disparaître le rappel de la page d'accueil.",
            "Les champs **Géré par l'administration** et le numéro de licence ne peuvent être modifiés que par le club.",
            "**Changer le mot de passe** conserve la clé de vos documents d'identité ; **Envoyer le lien de reinitialisation** la perd (voir la section Pièces d'identité)."
          ]
        },
        {
          "t": "note",
          "text": "Le nom, la langue, le téléphone, la date de naissance, l'adresse, le code postal, la localité et la nationalité sont obligatoires ; **Bienvenue au KSC Wiedikon** bloque l'application tant qu'ils ne sont pas remplis. Les modifications du nom, de l'e-mail, du téléphone, de la date de naissance, de l'adresse ou de la nationalité sont transmises au registre du club (**Mise à jour des données envoyée à l'administration**)."
        },
        {
          "t": "h",
          "text": "Confidentialité"
        },
        {
          "t": "ul",
          "items": [
            "**Masquer le numero de telephone** / **Masquer l'adresse e-mail** : les autres membres ne les voient jamais ; ces réglages les cachent aussi à vos coachs et responsables d'équipe (les admins du club les voient toujours).",
            "**Visibilite de la date de naissance** : **Afficher la date complete**, **Annee uniquement** ou **Masquer**. Seul **Afficher la date complete** fait apparaître votre anniversaire dans le calendrier.",
            "**Afficher uniquement le prenom sur le site** : sur kscw.ch, votre nom de famille devient une initiale (Anna M.) et votre année de naissance est cachée."
          ]
        },
        {
          "t": "h",
          "text": "Inscription automatique et notifications par e-mail"
        },
        {
          "t": "p",
          "text": "Les réglages **Inscription automatique** (**Entraînements**, **Matchs**, **Événements**) vous confirment automatiquement pour chaque nouvelle activité à venir de ce type. Les réponses déjà données et les jours d'absence ne sont jamais modifiés ; vous pouvez toujours vous désinscrire individuellement. Sous **Notifications par e-mail**, **Actualités du club** et **Invitations aux événements** sont activées pour tout le monde ; en désactiver une n'arrête que l'e-mail, la cloche l'affiche toujours. Les coachs, responsables d'équipe et admins voient des lignes supplémentaires pour leurs tâches."
        },
        {
          "t": "h",
          "text": "Documents et statut de licence"
        },
        {
          "t": "p",
          "text": "**Mes documents** liste les fichiers que vous avez téléversés lors de l'inscription ; touchez-en un pour l'afficher. La liste n'apparaît que si vous en avez téléversé. **Statut de licence** passe par **Pas de licence** → **À commander** → **Commandée** → **Finalisée** → **Licenciée**. Le club définit les quatre premiers ; **Licenciée** est confirmé automatiquement par la fédération. Vous êtes averti lorsque le club le modifie ou lorsqu'il passe à **Licenciée** ; le 1er juin, il revient silencieusement à **Pas de licence**."
        },
        {
          "t": "h",
          "text": "La vérification annuelle du profil"
        },
        {
          "t": "p",
          "text": "Avant la commande des licences de la saison prochaine, le club peut vous demander de vérifier vos données. **Merci de vérifier tes données** s'ouvre alors avec votre profil complet et ne peut pas être fermé. Vérifiez chaque champ mentionné dans la bannière, corrigez ce qui est faux et touchez **Tout est correct**. Les moins de 16 ans doivent le faire avec un parent. La fenêtre ne réapparaît pas avant la prochaine vérification."
        }
      ]
    },
    "household": {
      "title": "Ménages et comptes familiaux",
      "summary": "Un seul login parental pour plusieurs enfants : changer de membre, agir pour un enfant et ce qui reste bloqué.",
      "body": [
        {
          "t": "p",
          "text": "Un ménage permet à un login adulte d'agir pour plusieurs membres — typiquement un parent qui répond aux RSVP, saisit les absences et remplit les formulaires pour ses enfants. Chaque enfant garde sa propre fiche de membre, sa place dans l'effectif, ses cotisations et sa licence ; seul le login est partagé. Les ménages sont configurés par les admins du club, et seuls les membres ordinaires peuvent être gérés — pas les coachs, les responsables d'équipe, les Spielplaner ni les personnes ayant un rôle admin."
        },
        {
          "t": "h",
          "text": "Changer de membre"
        },
        {
          "t": "ol",
          "items": [
            "Touchez la barre colorée en haut de l'application ; elle affiche le nom de la personne pour laquelle vous agissez. La barre n'apparaît que pour les logins qui gèrent au moins un autre membre.",
            "Dans **Pour qui fais-tu cela ?**, choisissez **Moi** ou l'un de vos enfants. Chaque enfant est affiché avec son prénom, ses équipes et sa photo ou une initiale colorée.",
            "Toute l'application fonctionne désormais comme cet enfant : ses activités, son profil, ses absences et ses formulaires, et tout ce que vous enregistrez l'est pour lui. Touchez à nouveau la barre et choisissez **Moi** pour revenir à vous-même."
          ]
        },
        {
          "t": "p",
          "text": "Pendant que vous agissez pour un enfant, la barre prend la couleur propre à cet enfant, et les boutons de réponse des entraînements, matchs et événements portent le nom de l'enfant — pour une enfant appelée Mila, ils indiquent **Mila vient**, **Mila ne peut pas** et **Peut-être, Mila** — vous voyez ainsi toujours pour qui vous répondez."
        },
        {
          "t": "note",
          "text": "Agir pour un enfant est réel, pas un aperçu : ce que vous saisissez compte pour l'enfant et est enregistré sous son nom, et le journal d'audit du club note que c'est vous qui l'avez fait. Tous les onglets ouverts suivent le changement, et à chaque ouverture de l'application vous commencez en tant que vous-même — le dernier enfant utilisé n'est jamais restauré automatiquement."
        },
        {
          "t": "h",
          "text": "Ce qui est bloqué pendant que vous agissez pour un enfant"
        },
        {
          "t": "p",
          "text": "Ces actions appartiennent à un vrai login ou à la personne seule et sont refusées pendant que vous utilisez le compte d'un enfant :"
        },
        {
          "t": "ul",
          "items": [
            "Modifier ou définir un mot de passe, et supprimer le compte",
            "Voter dans les sondages (voir la section Sondages)",
            "Déléguer un service de marqueur (voir la section Service de marqueur)",
            "Créer ou renouveler un lien d'abonnement au calendrier — **S'abonner** sur la page du calendrier",
            "Ouvrir les documents d'identité : un membre géré ne s'est jamais connecté, il n'existe donc aucune clé pour lui"
          ]
        },
        {
          "t": "tip",
          "text": "Si l'application perd un jour la trace de la personne pour laquelle vous agissez, elle affiche **Quelque chose s’est désynchronisé — rechargement par sécurité** et se recharge d'elle-même."
        },
        {
          "t": "h",
          "text": "Comment un enfant obtient son propre login"
        },
        {
          "t": "p",
          "text": "Un enfant géré n'a pas de mot de passe et ne peut pas se connecter, mais reçoit tout de même les e-mails du club. Un membre qui possède déjà son propre login ne peut pas être ajouté comme membre géré. Quand un enfant est prêt pour son propre compte, demandez à un admin : l'enfant a besoin d'une adresse e-mail à lui, car chaque compte doit avoir sa propre adresse e-mail. Une fois l'invitation reçue, l'enfant choisit un mot de passe (voir la section Votre compte)."
        }
      ]
    },
    "forms": {
      "title": "Remplir des formulaires",
      "summary": "Où apparaissent les formulaires, comment y répondre avant l'échéance et quand vous pouvez modifier une réponse.",
      "body": [
        {
          "t": "p",
          "text": "Les coachs, les responsables d'équipe et le comité utilisent des formulaires pour recueillir des réponses auprès des membres, par exemple une commande de tenue ou un sondage. Lorsqu'un formulaire est ouvert pour vous, il apparaît sur votre page d'accueil et vous recevez une notification. Leur création est décrite dans la section Créer des formulaires."
        },
        {
          "t": "h",
          "text": "Où apparaissent les formulaires"
        },
        {
          "t": "ul",
          "items": [
            "Sur la page d'accueil, dans la carte bleue **Formulaires à remplir**, affichée uniquement tant qu'un formulaire est ouvert pour vous.",
            "Sur la page **Formulaires**, sous **Ouverts pour toi**. Les joueurs n'ont pas d'entrée de menu pour cette page ; l'entrée de la cloche **Nouveau formulaire :** suivie du titre du formulaire, ou la notification push intitulée **Nouveau formulaire**, vous y amène.",
            "Les coachs, les responsables d'équipe, le comité et les admins la trouvent sous **Outils membres → Formulaires** (ordinateur) ou **Plus → Outils membres → Formulaires** (téléphone)."
          ]
        },
        {
          "t": "p",
          "text": "Un formulaire est ouvert pour vous lorsqu'il s'adresse à tout le club ou à une équipe dans laquelle vous jouez. Si vous ne faites qu'entraîner une équipe, vous recevez ses notifications mais le formulaire n'est pas listé pour vous. Chaque entrée affiche le titre et, s'il y a une échéance, **Clôture** suivi de la date et de l'heure (30.09.2026 23:59). Vous êtes averti une seule fois par formulaire à son ouverture, dans la cloche et, si les notifications push sont activées, sur votre téléphone. Aucun e-mail n'est envoyé."
        },
        {
          "t": "h",
          "text": "Répondre à un formulaire"
        },
        {
          "t": "ol",
          "items": [
            "Touchez **Remplir**. Les questions marquées d'un * sont obligatoires.",
            "Répondez aux questions. Pour une question de type fichier, touchez **Choisir un fichier** ; la croix rouge à côté du nom du fichier le supprime pour que vous puissiez en choisir un autre.",
            "Touchez **Envoyer**. Vous voyez le texte de remerciement de l'auteur ou **Merci — ta réponse a été enregistrée.**, puis touchez **Terminé**."
          ]
        },
        {
          "t": "note",
          "text": "L'échéance est stricte. Après l'heure indiquée à côté de **Clôture**, ou dès que l'auteur ferme le formulaire, l'envoi échoue avec **Ce formulaire est fermé.** Une question obligatoire laissée vide affiche **Merci de répondre :** suivi de son nom."
        },
        {
          "t": "h",
          "text": "Modifier une réponse"
        },
        {
          "t": "p",
          "text": "Sur un formulaire normal, vous répondez une seule fois. Ensuite, le bouton indique **Modifier** au lieu de **Remplir** : changez ce dont vous avez besoin et touchez **Enregistrer**. Vous voyez **Ta réponse a été mise à jour.** ou le texte de remerciement. Cela fonctionne jusqu'à la clôture du formulaire."
        },
        {
          "t": "ul",
          "items": [
            "Les formulaires anonymes affichent **Ce formulaire est anonyme — tes réponses ne sont pas liées à ton nom.** Personne ne peut savoir quelle réponse est la vôtre, elle ne peut donc pas être modifiée, et le formulaire continue d'afficher **Remplir** après votre réponse. Ne le remplissez pas deux fois.",
            "Si l'auteur autorise plusieurs réponses par personne, le formulaire reste listé avec **Remplir** et l'écran de remerciement propose **Envoyer une autre réponse**. Les réponses précédentes ne peuvent pas être modifiées."
          ]
        },
        {
          "t": "h",
          "text": "Rappels"
        },
        {
          "t": "p",
          "text": "Si vous n'avez pas répondu, l'auteur peut envoyer un rappel : **Rappel — merci de remplir :** suivi du titre du formulaire dans la cloche, et une notification push intitulée **Rappel**. Les deux ouvrent la page **Formulaires**. Une fois que vous avez répondu, plus aucun rappel ne vous parvient."
        }
      ]
    },
    "polls": {
      "title": "Sondages",
      "summary": "Votez aux sondages de votre équipe et, en tant que coach ou responsable d'équipe, créez, fermez et consultez-les.",
      "body": [
        {
          "t": "p",
          "text": "Les sondages sont de courtes enquêtes d'équipe : une question, quelques options. Vous les trouvez sur la page de votre équipe sous **Sondages** — **Outils membres → Equipes** sur ordinateur (**Equipe** si vous n'êtes que dans une seule équipe), **Plus → Outils membres → Equipes** sur téléphone, puis choisissez votre équipe. Les sondages ouverts de vos équipes apparaissent aussi sur la page d'accueil sous **Sondages actifs**. La section ne s'affiche que pour les équipes où les sondages sont activés."
        },
        {
          "t": "h",
          "text": "Voter"
        },
        {
          "t": "ol",
          "items": [
            "Touchez une option. Un sondage à **Choix unique** n'accepte qu'un seul choix, un sondage à **Choix multiples** en accepte plusieurs.",
            "Touchez **Voter**. Votre réponse est marquée **Voté**.",
            "Pour la modifier, touchez **Modifier le vote**, ajustez vos choix et touchez de nouveau **Modifier le vote** — ou sur **Annuler** pour conserver l'ancienne réponse."
          ]
        },
        {
          "t": "note",
          "text": "Un sondage peut avoir une **Date limite** (dd.mm.yyyy). Vous pouvez voter pendant toute cette journée. Dès le lendemain, il affiche **Vote terminé**, disparaît de la carte d'accueil et n'accepte plus aucun vote, même si son badge reste **Ouvert** sur la page d'équipe jusqu'à ce qu'un responsable le ferme."
        },
        {
          "t": "h",
          "text": "Ce que vous voyez"
        },
        {
          "t": "ul",
          "items": [
            "Avec **Résultats visibles par tous**, les barres de résultats apparaissent une fois que vous avez voté, ou une fois le sondage fermé ou sa date limite dépassée.",
            "Sans cette option, vous ne voyez, après avoir voté, que votre propre réponse marquée et l'indication **Les résultats ne sont visibles que par les responsables d'équipe**.",
            "Avec **Vote anonyme**, personne — pas même votre coach — ne peut voir qui a choisi quoi ; seuls les totaux existent.",
            "Les sondages fermés se trouvent dans la liste repliable **Sondages fermés** en bas de la section."
          ]
        },
        {
          "t": "h",
          "text": "Si vous êtes coach ou responsable d'équipe"
        },
        {
          "t": "p",
          "text": "Vous (ou un admin en mode admin) gérez les sondages de votre équipe. Sur la page d'équipe, touchez **Créer un sondage** et remplissez :"
        },
        {
          "t": "ul",
          "items": [
            "**Question** et au moins deux **Options** (**Ajouter une option**, **Supprimer**). Le bouton **Créer un sondage** reste grisé tant que les deux ne sont pas renseignés.",
            "**Mode de vote** : **Choix unique** ou **Choix multiples**.",
            "**Date limite**, ou laissez le champ vide pour **Pas de date limite**.",
            "**Vote anonyme** (désactivé par défaut) masque qui a voté — pour vous aussi.",
            "**Résultats visibles par tous** (activé par défaut) ; désactivez-le pour réserver les totaux aux responsables."
          ]
        },
        {
          "t": "p",
          "text": "Vous voyez toujours le décompte en direct, même avant d'avoir voté. Sur les sondages non anonymes, chaque option liste ses votants sous **Voté par**. L'icône cadenas (**Fermer le sondage**) arrête le vote et déplace le sondage vers **Sondages fermés** ; l'icône corbeille (**Supprimer le sondage**) le supprime avec tous ses votes. Les deux fonctionnent sur la page d'équipe et sur la carte d'accueil."
        },
        {
          "t": "note",
          "text": "Fermer et supprimer sont définitifs : il n'y a pas de réouverture, et les votes supprimés sont perdus. L'application vous demande de confirmer les deux ; si vous avez besoin de nouvelles réponses plus tard, créez un nouveau sondage."
        },
        {
          "t": "tip",
          "text": "Les sondages s'activent par équipe dans l'éditeur d'effectif sous **Paramètres d'équipe → Fonctionnalités → Sondages (votes et decisions d'equipe)** — voir la section Éditeur d'effectif."
        }
      ]
    },
    "feedback": {
      "title": "Feedback, statut et nouveautés",
      "summary": "Signaler des bugs et des idées, vérifier l'état de l'application, lire les notes de version, et les pages légales et café.",
      "body": [
        {
          "t": "p",
          "text": "Tout ce qui suit se trouve sous **Options** : l'icône d'engrenage en haut à droite sur ordinateur, ou **Plus → Options** sur un téléphone. Sur un téléphone, le lien café se trouve dans le volet **Plus** à côté de votre profil, et les pages légales tout en bas de ce volet."
        },
        {
          "t": "h",
          "text": "Feedback et rapports de bugs"
        },
        {
          "t": "p",
          "text": "**Options → Feedback** ouvre **Feedback & bugs**. Touchez **Nouveau feedback**, choisissez **Bug**, **Fonctionnalité** ou **Feedback**, ajoutez un **Titre** court et une **Description** de ce qui s'est passé et de ce que vous attendiez, puis joignez jusqu'à cinq captures d'écran sous **Capture d'écran** (PNG, JPG ou WebP, max 5 Mo chacune). Ensuite, **Envoyer**."
        },
        {
          "t": "ul",
          "items": [
            "Les rapports **Bug** et **Fonctionnalité** ouvrent automatiquement un ticket GitHub ; un simple **Feedback** non.",
            "**Suivi des tickets**, sous le formulaire, liste les tickets **Ouvert**, les tickets **Résolu** étant repliés en dessous, pour que vous puissiez vérifier si un problème est déjà connu.",
            "Lorsque vous êtes connecté, **Mes soumissions** en bas liste ce que vous avez envoyé avec son état : **Nouveau**, **Ticket GitHub** ou **Fermé**.",
            "Une capture de l'écran exact plus la date et l'équipe concernée suffisent généralement pour corriger rapidement un bug."
          ]
        },
        {
          "t": "h",
          "text": "Page de statut"
        },
        {
          "t": "p",
          "text": "**Options → Statut** (connexion requise) indique si l'application et ses flux de données fonctionnent : **Serveur de l'app**, **Sync Swiss Volley**, **Sync Basketplan** et **Sync du plan de salle**, chacun avec le temps écoulé depuis la dernière exécution. La bannière affiche **Tous les systèmes fonctionnent**, **Une synchronisation est en retard** ou **Un service est hors ligne** ; **Correctifs récents** liste les problèmes résolus dernièrement. Consultez cette page en premier si les résultats ou le plan de salle semblent dépassés."
        },
        {
          "t": "h",
          "text": "Nouveautés"
        },
        {
          "t": "p",
          "text": "**Options → Nouveautes** ouvre le **Journal des modifications**. La version que vous utilisez (par exemple `v2.12.0`) est affichée en haut et à côté de l'entrée du menu. Chaque version est datée et découpée en courtes sections titrées, avec les changements listés en dessous. Les notes de version sont toujours en anglais, quelle que soit la langue de l'application."
        },
        {
          "t": "h",
          "text": "Confidentialité, mentions légales et le lien café"
        },
        {
          "t": "p",
          "text": "**Confidentialite** et **Mentions legales**, en bas du volet **Plus**, ouvrent la **Politique de confidentialite** (quelles données le club conserve, pourquoi, et qui peut les voir) et les **Mentions legales** avec l'adresse du club et l'e-mail de contact. La politique de confidentialité est celle que vous avez acceptée lors de la création de votre compte."
        },
        {
          "t": "p",
          "text": "**Offre-moi un café** (menu de l'avatar sur ordinateur, volet **Plus** sur un téléphone, et en bas de **Nouveautes**) ouvre **Offrir un café au développeur** : un remerciement personnel à la personne qui développe Wiedisync, payé avec TWINT. Touchez **Copier le numéro** et collez-le dans l'application TWINT."
        },
        {
          "t": "note",
          "text": "Ce n'est pas un don au club : ce n'est pas déductible des impôts et cela n'a aucun effet sur votre cotisation. Rien n'est payé dans l'application. Le lien n'apparaît que pour les membres de 18 ans ou plus dont la date de naissance figure sur leur profil."
        }
      ]
    },
    "dues": {
      "title": "Factures et remboursements",
      "summary": "Vos factures du club, comment les payer par QR-facture, et où trouver vos remboursements et frais d'arbitrage.",
      "body": [
        {
          "t": "p",
          "text": "Ouvrez **Finances → Finances personnelles → Factures et remboursements** sur ordinateur, ou **Plus → Finances → Finances personnelles → Factures et remboursements** sur téléphone. La carte **Vos factures** sur l'accueil y mène tant qu'une facture est à payer. Les factures adressées à une équipe que vous dirigez se trouvent dans la section Finances d'équipe ; les amendes dans la section Amendes."
        },
        {
          "t": "h",
          "text": "Vos factures"
        },
        {
          "t": "p",
          "text": "La tuile **Solde ouvert** indique ce que vous devez encore. Chaque facture affiche **Objet**, **Date**, **Échéance**, **Montant**, **Ouvert** et **Statut** : **Ouverte**, **Partiellement payée**, **En attente de confirmation**, **Payée** ou **Annulée** ; les factures reprises de ClubDesk gardent leur statut en allemand. Une adhésion gratuite affiche soit **Rien à payer — ton adhésion est gratuite.**, soit une facture de CHF 0.00 qui en indique la raison."
        },
        {
          "t": "p",
          "text": "Le montant dépend de la **Catégorie de cotisation** sous **Géré par l'administration** dans **Mon profil** ; demandez au trésorier pour la modifier. Le tarif inclut votre licence de fédération ; la facture détaille cette part sans augmenter le total. Les membres soumis au service de marqueur sans licence de marqueur paient CHF 100.00 de plus, les membres qui ne sont que joueurs invités (dans le noyau d'aucune équipe) paient CHF 110.00 de moins, et les membres d'honneur, les membres du comité et les coachs d'une équipe active sont facturés CHF 0.00. Les responsables d'équipe paient le tarif normal."
        },
        {
          "t": "h",
          "text": "Payer une facture"
        },
        {
          "t": "ol",
          "items": [
            "Touchez une facture ouverte pour la déplier. Une QR-facture suisse apparaît avec le montant ouvert prérempli.",
            "Scannez-la avec TWINT ou votre application bancaire et payez.",
            "Touchez **Marquer comme payée**. La facture passe à **En attente de confirmation** et quitte votre solde ouvert."
          ]
        },
        {
          "t": "note",
          "text": "**Marquer comme payée** est votre déclaration, pas le paiement. Le club passe la facture à **Payée** une fois l'argent arrivé ; le bouton ne fonctionne que tant que la facture est encore **Ouverte**."
        },
        {
          "t": "h",
          "text": "IBAN pour remboursements"
        },
        {
          "t": "p",
          "text": "La carte **IBAN pour remboursements** contient le compte sur lequel le club vous rembourse. Touchez **Ajouter l’IBAN** (ou **Modifier**), puis **Enregistrer** ; les IBAN invalides sont refusés. Si le club a déjà votre IBAN via ClubDesk, répondez **Oui, c'est correct** ou **Modifier**. Seuls les finances et les admins peuvent le voir. D'ici là, l'accueil affiche **Ajoute ton IBAN** ou **Confirme ton IBAN** ; **Plus tard** masque cette carte."
        },
        {
          "t": "tip",
          "text": "Les versements nécessitent un IBAN suisse ou liechtensteinois ainsi que votre code postal et votre localité dans votre profil — sinon le versement est ignoré et les finances en sont informées."
        },
        {
          "t": "h",
          "text": "Remboursements et frais d'arbitrage"
        },
        {
          "t": "ul",
          "items": [
            "**Remboursements pour toi** liste les versements que le club vous envoie. **Annoncé** signifie pas encore viré, **Payé** signifie viré ; **Télécharger le PDF** enregistre le document. Les remboursements de frais apparaissent ici une fois que les finances les ont marqués comme payés (voir la section Remboursement de frais).",
            "**Frais d’arbitrage que tu as payés** liste les frais que vous avez avancés de votre poche lors des matchs à domicile de volleyball, enregistrés par le staff de votre équipe sous **Frais d'arbitrage** dans les détails du match. **Fin de saison** signifie en attente du décompte de fin de saison, **Remboursé** avec une date signifie payé ; **À rembourser** totalise cette saison."
          ]
        }
      ]
    },
    "expenses": {
      "title": "Remboursement de frais",
      "summary": "Téléversez un justificatif pour une dépense faite pour le club et suivez-la jusqu'au remboursement.",
      "body": [
        {
          "t": "p",
          "text": "Vous avez payé des ballons, une taxe de tournoi ou autre chose pour le club ? Téléversez le justificatif et les finances vous remboursent. La page s'appelle **Téléverser une facture**, sous **Finances → Finances personnelles → Téléverser une facture** (ordinateur) ou **Plus → Finances → Finances personnelles → Téléverser une facture** (téléphone)."
        },
        {
          "t": "h",
          "text": "Téléverser un justificatif"
        },
        {
          "t": "ol",
          "items": [
            "Passez la vérification de sécurité à côté de la zone de téléversement ; le téléversement reste désactivé jusque-là.",
            "Touchez **Choisis un fichier ou dépose-le ici** et sélectionnez le justificatif : PDF, JPG ou PNG, 8 Mo au maximum.",
            "Attendez que l'application analyse le document. Sous **Vérifie les détails**, elle pré-remplit **Montant**, **Devise**, **Date**, **Fournisseur**, **Description** et **Référence**. Corrigez ce qui ne va pas ; si l'analyse échoue, remplissez les champs vous-même. **Utiliser un autre fichier** recommence depuis le début.",
            "Vérifiez **Rembourser sur ce compte**, ajoutez une **Note pour les finances** si utile, et cochez **Déjà payé ?** si vous avez déjà réglé la facture vous-même, de votre poche.",
            "Touchez **Envoyer aux finances**. Les finances reçoivent un e-mail avec votre justificatif en pièce jointe et vous en recevez une copie."
          ]
        },
        {
          "t": "note",
          "text": "**Montant** et un IBAN valide sont requis pour envoyer. Vous pouvez scanner au maximum 5 justificatifs et envoyer au maximum 5 demandes par heure. Envoyer deux fois le même fichier ne crée pas de seconde demande."
        },
        {
          "t": "h",
          "text": "Votre IBAN"
        },
        {
          "t": "p",
          "text": "**Rembourser sur ce compte** est pré-rempli avec l'IBAN de votre profil ; vous pouvez le modifier pour cette seule dépense. Pour le mettre à jour pour tous les versements futurs, utilisez la carte **IBAN pour remboursements** décrite dans la section Factures et remboursements, qui indique aussi ce qu'un versement nécessite."
        },
        {
          "t": "h",
          "text": "Mes soumissions"
        },
        {
          "t": "ul",
          "items": [
            "**En attente** : envoyée, pas encore traitée par les finances.",
            "**Payée** : les finances ont viré l'argent. La demande apparaît aussi sous **Remboursements pour toi** sur **Factures et remboursements**, où vous pouvez télécharger le document de versement en PDF.",
            "**Refusée** : les finances ont rejeté la demande."
          ]
        },
        {
          "t": "p",
          "text": "Le tableau **Mes soumissions** en bas de la page liste chaque demande avec la date, le montant, le fournisseur et le **Statut** ; une éventuelle note des finances apparaît sous le statut. **Justificatif** ouvre le fichier que vous avez téléversé. Quand une demande passe à **Payée** ou **Refusée**, vous recevez une notification dans l'application, un message push et un e-mail dans votre langue, avec la note des finances."
        },
        {
          "t": "h",
          "text": "Qui confirme votre dépense"
        },
        {
          "t": "p",
          "text": "Votre demande est transmise à la TK de votre section, l'admin VB ou l'admin BB. La TK confirme que la dépense est budgétée et indique aux finances si la section vous a déjà remboursé. Cela ne change rien à ce que vous voyez : seules les finances font passer une demande de **En attente** à **Payée** ou **Refusée**. La file d'attente se trouve sous **Finances → Finances du club → Confirmer les dépenses** (voir la section Finances du club)."
        }
      ]
    },
    "fines": {
      "title": "Amendes",
      "summary": "Vos amendes, comment elles naissent automatiquement, paiement et annulation, et la vue des amendes d'équipe.",
      "body": [
        {
          "t": "p",
          "text": "Les amendes sont les petites pénalités qu'une équipe facture pour les inscriptions tardives, les absences non annoncées et cas similaires. Les vôtres figurent sous **Finances → Finances personnelles → Mes amendes** (sur un téléphone, ouvrez d'abord **Plus**). La carte **Amendes ouvertes** de la page d'accueil vous y mène aussi."
        },
        {
          "t": "h",
          "text": "Vos amendes"
        },
        {
          "t": "ul",
          "items": [
            "**Mes amendes** liste chaque amende avec **Équipe**, **Catégorie**, **Montant**, **Statut**, **Émise le** et **Motif** (les deux derniers seulement sur les écrans larges).",
            "La liste s'ouvre sur **Ouverte** ; choisissez **Payée**, **Annulée** ou **Toutes** pour voir l'historique.",
            "**Dû**, en haut, n'additionne que vos amendes personnelles ouvertes."
          ]
        },
        {
          "t": "h",
          "text": "Comment naît une amende"
        },
        {
          "t": "ul",
          "items": [
            "**Inscription tardive** — vous n'aviez pas répondu avant le délai, ou un coach a dû vous confirmer après celui-ci.",
            "**Absence** — vous étiez inscrit·e mais n'êtes pas venu·e.",
            "**Retard de paiement** et **Autre** — émises à la main pour tout autre motif.",
            "Chaque équipe définit son propre barème : le montant augmente à chaque récidive dans la même catégorie (par exemple CHF 10.00, puis CHF 20.00) et se réinitialise après une fenêtre allant de **Mois calendaire** à **À vie**."
          ]
        },
        {
          "t": "note",
          "text": "Si votre équipe a activé les amendes pour inscription tardive, toute personne qui n'a pas répondu à un entraînement ou à un match avant le délai est inscrite comme absente et sanctionnée automatiquement le lendemain matin. Répondez avant le délai, même par un non. Si un coach vous confirme après le délai, il lui est demandé s'il veut vous sanctionner."
        },
        {
          "t": "h",
          "text": "Paiement, annulations et notifications"
        },
        {
          "t": "ul",
          "items": [
            "L'app n'encaisse pas d'argent. Réglez l'amende auprès de votre coach ou de votre responsable d'équipe ; il appuie sur **Marquer comme payée**.",
            "Un coach peut **Annuler** une amende ouverte, toujours avec un motif. Le montant, la catégorie et le motif ne peuvent plus être modifiés ensuite — une amende erronée est annulée puis réémise.",
            "Une entrée dans la cloche et une notification push vous préviennent quand une amende est émise (**Nouvelle amende**), payée (**Amende payée**) ou annulée (**Amende annulée**) ; une amende automatique pour inscription tardive arrive sous forme d'une seule notification **Entraînement : délai dépassé** ou **Match : délai dépassé**. Après 14 jours, vous recevez un rappel **Amende(s) ouverte(s)** par jour."
          ]
        },
        {
          "t": "h",
          "text": "Amendes pour toute l'équipe"
        },
        {
          "t": "p",
          "text": "Un coach peut aussi sanctionner toute l'équipe. L'amende affiche **Toute l'équipe** au lieu d'un nom, est due par la caisse de l'équipe et ne compte jamais dans votre **Dû**. Vous la trouvez dans l'onglet **Équipe** (**Finances → Finances d’équipe → Amendes d’équipe**) et sur la carte de la page d'accueil."
        },
        {
          "t": "h",
          "text": "Si vous êtes coach ou responsable d'équipe"
        },
        {
          "t": "p",
          "text": "**Amendes d’équipe** montre toutes les amendes de vos équipes. **Émettre une amende** demande d'abord **Qui reçoit l'amende ?** (**Un membre** ou **Toute l'équipe**), puis l'équipe et le membre ; le montant se remplit d'après votre barème (modifiable). Une amende d'équipe exige un montant manuel et notifie toute l'équipe. Barèmes et balayage automatique : voir la section Règles d'amendes. La tuile **Amendes de caisse d’équipe ouvertes** : voir la section Finances d'équipe."
        }
      ]
    },
    "roster": {
      "title": "Éditeur d'effectif",
      "summary": "Gérer l'effectif de votre équipe : joueurs, numéros, postes, niveaux d'invité, invitations et demandes d'adhésion.",
      "body": [
        {
          "t": "p",
          "text": "Ouvrez **Outils membres → Equipes** (**Equipe** si vous n'êtes que dans une équipe ; sur téléphone : **Plus → Outils membres → Equipes**), choisissez votre équipe et touchez **Modifier l'equipe**. En haut de **Modifier l'effectif**, vous définissez la **Photo d'equipe** avec **Telecharger une photo** ou **Supprimer la photo** (JPG ou PNG, 10 Mo max.). Sur la page de l'équipe, touchez la photo, choisissez **Ajuster le cadrage**, puis **Enregistrer**."
        },
        {
          "t": "h",
          "text": "Joueurs de l'effectif"
        },
        {
          "t": "ul",
          "items": [
            "**Ajouter un joueur** : saisissez au moins deux lettres dans **Rechercher par nom...** et touchez le membre. Seuls les membres actifs du club sont proposés.",
            "Retirer : touchez le X rouge, puis **Retirer** dans la boîte de dialogue **Retirer le joueur**.",
            "Numéro : touchez la valeur **#**, saisissez le numéro et touchez Entrée.",
            "**Poste** : cochez un ou plusieurs postes. **Staff uniquement** est destiné à un coach ou un responsable d'équipe qui ne joue pas ; il ne reçoit pas de numéro.",
            "**K** désigne le capitaine ; toucher **K** sur le capitaine actuel retire la désignation.",
            "**G** fait défiler le niveau d'invité : **G** → **G1** → **G2** → **G3** → retour au début. L'enregistrement est immédiat."
          ]
        },
        {
          "t": "note",
          "text": "Les niveaux d'invité 1 à 3 fixent la priorité lorsque les entraînements sont complets : le niveau 1 est le plus élevé, le niveau 3 le plus bas. Les invités figurent sous **Invités** sur la page de l'équipe et ne sont pas pris en compte lors de la confirmation automatique des matchs."
        },
        {
          "t": "h",
          "text": "Faire entrer des personnes dans l'application"
        },
        {
          "t": "ul",
          "items": [
            "Une icône d'enveloppe (**Envoyer une invitation WiediSync**) apparaît à côté des joueurs qui ont une adresse e-mail mais pas de connexion. Touchez-la : l'invitation est envoyée par e-mail et un code QR avec **Copier le lien** s'ouvre ; il fonctionne une seule fois, pendant 30 jours.",
            "**Ajouter un utilisateur externe** sert pour une personne qui n'est pas encore membre du club. Choisissez **Rejoindre en tant que :** **Joueur/euse** ou **Invité·e** niveau 1 à 3, touchez **Générer le code QR** et montrez le code ou utilisez **Copier le lien**. Le lien fonctionne une seule fois et expire après 7 jours ; au maximum 20 invitations ouvertes par équipe.",
            "La personne saisit son nom et son e-mail, confirme le code reçu par e-mail et définit un mot de passe. Elle rejoint l'effectif immédiatement, marquée **Temporaire** ; si la connexion n'est pas activée dans les 30 jours, l'entrée disparaît d'elle-même (un e-mail de rappel est envoyé 10 jours avant)."
          ]
        },
        {
          "t": "h",
          "text": "Demandes d'adhésion"
        },
        {
          "t": "p",
          "text": "Lorsqu'un membre demande à rejoindre votre équipe, chaque coach et responsable d'équipe reçoit une notification **Demande d'adhésion** et un e-mail. Un encadré ambre sur la page de l'équipe l'affiche : choisissez **Rejoindre en tant que :** **Joueur/euse** ou **Invité·e** niveau 1 à 3, puis **Approuver** ou **Rejeter**. Les demandes d'inscription de nouveaux membres qui ont choisi votre équipe apparaissent dans le même encadré, avec seulement **Approuver** et **Rejeter**."
        },
        {
          "t": "note",
          "text": "**Rejeter** une demande d'inscription met fin à l'adhésion de la personne au club et à son accès à l'application, sans étape de confirmation. Rejeter la demande d'adhésion d'un membre existant ne fait que clore cette demande."
        },
        {
          "t": "h",
          "text": "Si vous êtes admin"
        },
        {
          "t": "p",
          "text": "Seuls les admins en mode admin modifient la liste du staff : **Gérer le staff**, à côté de **Staff** sur la page de l'équipe, ajoute ou retire des membres sous **Entraîneurs** et **Responsables d'équipe**, ce qui accorde ou révoque aussi leur accès de responsable dans l'application."
        }
      ]
    },
    "coaching": {
      "title": "Gérer entraînements, matchs et événements",
      "summary": "Comment les coachs et responsables d'équipe créent, modifient et annulent des activités, convoquent des joueurs et lisent les présences.",
      "body": [
        {
          "t": "p",
          "text": "Vous gérez les activités sur les mêmes pages que vos joueurs utilisent (voir les sections Entraînements, Matchs et résultats et Événements). Les commandes supplémentaires n'apparaissent que pour les équipes que vous dirigez."
        },
        {
          "t": "h",
          "text": "Entraînements"
        },
        {
          "t": "ul",
          "items": [
            "**Nouvel entrainement** → **Entrainement unique** : **Creneau auto** reprend l'heure et la salle du créneau de l'équipe ; **Manuel** vous laisse les définir. Les valeurs par défaut de l'équipe préremplissent **Min. participants**, **Annulation automatique**, **Note obligatoire en cas d'absence** et **Repondre avant le**.",
            "**Nouvel entrainement** → **Entrainements recurrents** : choisissez un créneau de salle ou un jour de la semaine manuel, une période ou **Indefiniment**, puis **Apercu des dates** et **Generer**. Les dates passées, fermées ou déjà occupées sont ignorées.",
            "Modifier un entraînement lié à un créneau de salle demande la portée : **Cet entrainement uniquement**, **Tous les entrainements du meme jour de la semaine** ou **Tous les entrainements recurrents**. Les modifications se répercutent sur les futurs entraînements du créneau ; les dates, non.",
            "**Annuler l’entraînement** notifie l'équipe et libère le créneau de salle ; **Rétablir** le reprend."
          ]
        },
        {
          "t": "note",
          "text": "L'application raccourcit ou annule aussi l'entraînement d'une autre équipe lorsqu'un match à domicile a besoin de la salle, et annule l'entraînement d'une équipe le jour de son match. Un entraînement que vous rétablissez à la main n'est plus touché."
        },
        {
          "t": "h",
          "text": "Événements"
        },
        {
          "t": "ul",
          "items": [
            "**Nouvel evenement** : titre, type, dates ou **Toute la journee**, **Heure de rassemblement**, lieu et les options de réponse (**Repondre avant le**, **Autoriser les reponses « Peut-etre »**, **Max. participants**).",
            "Laissez **Equipes** vide pour un événement à l'échelle du club ; désactivez **Inviter les joueur·euses invite·es** pour exclure les joueurs invités.",
            "Événements sur plusieurs jours : **Mode de participation** → **Par jour** ou **Par creneau** permet de répondre par jour ou par créneau.",
            "Le **Lien d'inscription public**, pour les personnes sans compte, apparaît si vous avez créé l'événement ou si le **Mode admin** est activé : **Créer le lien**, **Remplacer le lien** (l'ancien lien cesse de fonctionner) ou **Désactiver** (les inscriptions sont conservées). Seuls les admins voient **Toutes les inscriptions**."
          ]
        },
        {
          "t": "h",
          "text": "Matchs"
        },
        {
          "t": "ul",
          "items": [
            "Les résultats arrivent pendant la nuit depuis les fédérations, pas de vous.",
            "**Fixer le delai** fixe le délai de réponse. **Heure de rassemblement** est enregistrée en minutes avant le début, elle survit donc à un report.",
            "**Joueur·euses convoqué·es** : **Convoquer des joueur·euses** d'une autre équipe du même sport, **Ouvrir à une équipe entière** ou individuellement. Ils sont notifiés et peuvent répondre ; **A un match ce jour-là** signale un conflit.",
            "**Frais d'arbitrage** (matchs à domicile de volleyball) : indiquez qui a payé les arbitres et combien ; la page d'accueil affiche **Enregistrer maintenant** pendant 14 jours (voir la section Finances d'équipe)."
          ]
        },
        {
          "t": "h",
          "text": "Présences et capacité"
        },
        {
          "t": "p",
          "text": "L'onglet **Tableau de bord entraineur** sur les pages Entraînements et Matchs et résultats affiche par joueur **Present**, **Absent**, **Taux** (vert à partir de 80 %, orange à partir de 50 %) et **Tendance** pour une période **De**/**À**. Confirmé compte comme présent ; refusé, une absence ou l'absence de réponse à une activité passée compte comme absent (contrairement aux **Statistiques** d'un profil de joueur, qui laissent de côté les activités couvertes par une absence). **Championnat uniquement** exclut les matchs de coupe."
        },
        {
          "t": "tip",
          "text": "Dans **Voir la liste**, vous pouvez modifier la réponse de n'importe quel joueur ou l'**Effacer**. Pour un événement avec **Max. participants**, la liste affiche les places restantes ou **Complet**."
        }
      ]
    },
    "matchsheet": {
      "title": "Feuille de match",
      "summary": "Numéros, capitaine et libero par match, modifications d'urgence de la liste et affichage des pièces d'identité à la table.",
      "body": [
        {
          "t": "p",
          "text": "La feuille de match reprend la présentation de la version papier : **Naissance**, **N°** et **Nom**, le numéro du capitaine entouré, les liberos répétés sous **Libero**, les coachs sous **Officiels**. Ouvrez un match à venir depuis **Activités → Matchs et resultats** (ordinateur) ou l'onglet **Matchs** (téléphone) et touchez **Feuille de match**. Elle s'ouvre en plein écran et se zoome avec deux doigts pour le marqueur."
        },
        {
          "t": "p",
          "text": "Le bouton apparaît pour le coach ou le responsable de l'équipe qui joue, à domicile comme à l'extérieur, de six heures avant le début jusqu'à trois heures après. Le marqueur désigné (service de marqueur uniquement, pas le tableau d'affichage) voit une version en lecture seule à partir de 40 minutes avant un match à domicile. En dehors de cette fenêtre, vous ne voyez que **La feuille de match s'ouvre peu avant le match et se ferme 3 heures après.**"
        },
        {
          "t": "h",
          "text": "D'où viennent les joueurs"
        },
        {
          "t": "ul",
          "items": [
            "**D'après l'Einsatzliste enregistrée dans Volleymanager.** C'est cette liste qui décide qui joue. La colonne **✓** compare chaque joueur à sa réponse : coche verte pour confirmé, marque orange pour peut-être ou sans réponse, croix rouge pour décliné.",
            "**D'après les présences confirmées — aucune Einsatzliste disponible.** La solution de repli pour le basketball et les listes non enregistrées (pas de colonne **✓**).",
            "Un signe d'avertissement signifie que Volleymanager signale ce joueur comme non qualifié."
          ]
        },
        {
          "t": "h",
          "text": "Modifier la feuille"
        },
        {
          "t": "ol",
          "items": [
            "Touchez **Modifier**.",
            "Saisissez le numéro de maillot (1–99) dans la colonne **N°**.",
            "Touchez **C** pour désigner le capitaine (un seul par feuille) et **L** pour désigner un libero.",
            "Touchez **Enregistrer** ; la légende affiche alors **Adapté par** suivi de votre nom. **Terminé** quitte le mode d'édition sans enregistrer."
          ]
        },
        {
          "t": "note",
          "text": "Enregistré pour ce match uniquement : l'effectif de l'équipe, le capitaine de l'équipe et Volleymanager ne sont pas modifiés. La feuille est toujours triée par numéro, les joueurs sans numéro en dernier."
        },
        {
          "t": "p",
          "text": "Modifications d'urgence : en mode d'édition, **Ajouter depuis l'équipe · uniquement en cas d'urgence** liste le reste de l'effectif. **+** ajoute un joueur, **✕** le raye (barré) et **↺** le remet. Tout ajout ou retrait fait apparaître le bannière rouge **La liste des joueurs diffère de l'Einsatzliste** : l'application ne transmet rien, vous devez donc saisir la même modification à la main dans Volleymanager. **Rétablir l'Einsatzliste** (affiché une fois que vous avez enregistré) supprime toutes les adaptations pour ce match, numéros compris."
        },
        {
          "t": "h",
          "text": "Afficher les documents d'identité"
        },
        {
          "t": "p",
          "text": "Les coachs et responsables d'équipe (pas les admins) disposent aussi de **Afficher les documents d'identité** : les pièces d'identité des joueurs, déchiffrées sur votre appareil avec votre propre clé (voir la section Pièces d'identité). Touchez **Déverrouiller** une fois par appareil, puis **Télécharger pour hors ligne** tant que vous avez du réseau. Cela fonctionne de 45 minutes avant le début jusqu'au début : parcourez les joueurs dans l'ordre de la feuille ; les scans PDF s'ouvrent dans une visionneuse ; chacun porte un filigrane. Au début du match, les documents sont supprimés du téléphone, et chaque ouverture est journalisée."
        },
        {
          "t": "h",
          "text": "Si vous êtes capitaine"
        },
        {
          "t": "p",
          "text": "Votre numéro est celui qui est entouré ; le coach attribue le **C** pour chaque match. Vous ne pouvez pas ouvrir la feuille vous-même : demandez au coach, au responsable d'équipe ou au marqueur."
        }
      ]
    },
    "broadcast": {
      "title": "Contacter : joindre tout le monde sur une activité",
      "summary": "Envoyez un e-mail ou un push aux personnes d'un match, d'un entraînement ou d'un événement, filtrées par statut RSVP.",
      "body": [
        {
          "t": "p",
          "text": "**Contacter** envoie un seul message à toutes les personnes rattachées à une activité. Ouvrez un match, un entraînement ou un événement depuis **Accueil**, le **Calendrier** ou **Activités → Matchs et resultats**, **Entrainements** ou **Evenements** (sur téléphone : les onglets du bas, ou **Plus → Evenements**). Le bouton **Contacter** se trouve à côté de **Partager le lien** dans la fenêtre de détail. Sur les matchs, il n'apparaît que tant que le match est encore programmé."
        },
        {
          "t": "h",
          "text": "Qui peut envoyer"
        },
        {
          "t": "ul",
          "items": [
            "Les coachs et responsables d'équipe : uniquement les matchs et entraînements de leur propre équipe, pas les événements.",
            "Les admins volleyball et basketball : les matchs et entraînements de leur sport.",
            "Les admins : toutes les activités. Les membres du comité : les événements ; pour les matchs et entraînements, ils ont besoin de l'un des rôles ci-dessus.",
            "Les capitaines et les joueurs ne voient jamais le bouton."
          ]
        },
        {
          "t": "h",
          "text": "Envoyer un message"
        },
        {
          "t": "ol",
          "items": [
            "Sous **Canal**, cochez **Email** (activé par défaut) et/ou **Push** (désactivé par défaut). Au moins un des deux est requis.",
            "Sous **Destinataires**, cochez les statuts RSVP souhaités : **Confirmé**, **Peut-être**, **Refusé**, **Liste d’attente** et **Sans réponse**. **Confirmé** et **Peut-être** sont cochés d'avance.",
            "Sur un événement, cochez **Inclure les inscriptions externes** pour envoyer aussi un e-mail aux personnes inscrites via le lien public.",
            "Vérifiez l'aperçu (**Destinataires : 12 (10 membres · 2 externes)** et quelques noms d'exemple). S'il indique **Personne ne correspond à ces filtres.**, modifiez les cases cochées : le message ne serait envoyé à personne.",
            "Rédigez un **Sujet** (affiché uniquement lorsque **Email** est activé, 3 à 200 caractères) et un **Message** (2000 caractères au maximum).",
            "Touchez **Envoyer**, puis confirmez **Envoyer le broadcast ?**. Une confirmation **Broadcast envoyé : 12 destinataires** apparaît."
          ]
        },
        {
          "t": "h",
          "text": "Qui le reçoit"
        },
        {
          "t": "ul",
          "items": [
            "**Sans réponse** désigne toutes les personnes de l'effectif concerné qui n'ont pas répondu du tout : pour les matchs, l'effectif de base sans les joueurs convoqués, pour les entraînements, l'effectif selon les règles d'invités de l'entraînement, pour les événements, les équipes et membres invités.",
            "Les membres désactivés ne sont jamais contactés. Les e-mails partent à chaque membre sélectionné disposant d'une adresse e-mail ; les pushs uniquement aux membres ayant activé les notifications push sur un appareil. Les inscriptions externes ne reçoivent qu'un e-mail.",
            "Chaque personne reçoit son propre e-mail dans sa langue, avec votre nom, les détails de l'activité, votre message et un bouton **Ouvrir dans Wiedisync**. Personne ne voit les autres adresses.",
            "Un push affiche votre sujet comme titre et les 200 premiers caractères de votre message. Le toucher ouvre l'activité."
          ]
        },
        {
          "t": "note",
          "text": "Les e-mails de broadcast sont toujours envoyés : ils ne tiennent pas compte des interrupteurs **Notifications par e-mail** du profil d'un membre. L'envoi ne peut pas être annulé, lisez donc l'aperçu avant de confirmer."
        },
        {
          "t": "note",
          "text": "Limites : au plus 3 messages par activité et par heure, au moins 20 minutes entre deux messages sur la même activité (quel que soit l'expéditeur), et au plus 10 messages par expéditeur et par heure. Au-delà, vous voyez un message tel que **Patiente 14 minute(s) et réessaie.**"
        },
        {
          "t": "tip",
          "text": "Si vous cochez uniquement **Push**, il n'y a pas de champ **Sujet** ; le push utilise alors le titre de l'activité."
        }
      ]
    },
    "teamfinance": {
      "title": "Finances d'équipe",
      "summary": "Factures d'équipe, écritures de la caisse d'équipe et frais d'arbitrage de votre équipe, et le remboursement de fin de saison.",
      "body": [
        {
          "t": "p",
          "text": "Ouvrez **Finances → Finances d’équipe → Finances d’équipe** sur ordinateur ; sur un téléphone, les mêmes entrées se trouvent sous **Plus → Finances**. L'entrée apparaît dès que vous faites partie d'une équipe active en tant que joueur, coach, responsable d'équipe ou capitaine. Choisissez l'**Équipe** et la **Saison** (cette saison ou la précédente)."
        },
        {
          "t": "h",
          "text": "Ce que la page affiche"
        },
        {
          "t": "ul",
          "items": [
            "**Solde** : **Recettes** moins **Dépenses** des écritures de la caisse d'équipe.",
            "**Factures d’équipe ouvertes** : ce que l'équipe doit encore sur les factures qui lui sont adressées.",
            "**Frais d’arbitrage cette saison** : frais payés lors des matchs de volleyball à domicile. Affichés pour information, jamais inclus dans le solde.",
            "**Amendes de caisse d’équipe ouvertes** : amendes ouvertes infligées à toute l'équipe. **Voir les amendes de l’équipe** ouvre la vue des amendes d'équipe (voir la section Amendes)."
          ]
        },
        {
          "t": "h",
          "text": "Factures d'équipe"
        },
        {
          "t": "p",
          "text": "Les finances peuvent adresser une facture à l'équipe plutôt qu'à une personne, par exemple une amende de la fédération. Elle apparaît sous **Factures d’équipe** et, si vous dirigez l'équipe, sous la forme **Factures d’équipe ouvertes : CHF 120.00** sur la carte **Vos factures** de l'Accueil. En tant que coach, responsable d'équipe ou capitaine, touchez la facture ouverte pour afficher sa QR-facture, payez avec TWINT ou votre application bancaire, puis touchez **Marquer comme payée**. La facture passe en **En attente de confirmation** et seules les finances la marquent **Payée** une fois l'argent reçu. Les membres de l'effectif voient les factures d'équipe en lecture seule."
        },
        {
          "t": "h",
          "text": "Écritures et frais d'arbitrage"
        },
        {
          "t": "p",
          "text": "**Écritures** liste les mouvements de la caisse d'équipe pour la saison. Les lignes **Sponsoring**, **Autres recettes** et **Dépense** sont saisies par les finances ; vous ne pouvez pas les ajouter ici. Les lignes **Frais d’arbitrage** proviennent des matchs : après un match de volleyball à domicile, un coach ou un responsable d'équipe ouvre le match dans **Activités → Matchs et resultats** (l'onglet **Matchs** sur un téléphone) et remplit **Frais d'arbitrage** avec **Payé par** (un membre de l'effectif ou **Autre personne** avec un nom), **Montant (CHF)** et **Remarques**, puis **Enregistrer**. Les capitaines ne peuvent pas saisir de frais. Chaque ligne indique qui a payé et un statut."
        },
        {
          "t": "h",
          "text": "Remboursement de fin de saison"
        },
        {
          "t": "p",
          "text": "Le club rembourse les frais d'arbitrage une fois par saison, en un seul versement par membre, effectué par les finances. Jusque-là, un frais affiche **Fin de saison** ; **Enregistré** signifie qu'il a été saisi avec CHF 0.00 ; **Annoncé** signifie que le versement existe mais que l'argent n'a pas encore été envoyé ; **Remboursé 15.06.2026** signifie qu'il est réglé. Après le versement, l'écriture du match est verrouillée : **Remboursé par le club — plus modifiable.** La personne qui a payé retrouve les mêmes frais sous **Frais d’arbitrage que tu as payés** dans **Factures et remboursements**."
        },
        {
          "t": "tip",
          "text": "Un versement est ignoré si la personne qui a payé n'a pas d'IBAN suisse ou liechtensteinois, ou pas de code postal et de localité, dans son profil. Demandez à la personne concernée de vérifier son profil avant la fin de la saison."
        },
        {
          "t": "note",
          "text": "Si la page affiche **Aucun exercice n’existe encore pour cette saison — les écritures et factures apparaîtront dès que les finances l’ouvriront.**, rien n'est perdu : les finances n'ont simplement pas encore ouvert les comptes de la saison."
        }
      ]
    },
    "finerules": {
      "title": "Règles d'amendes",
      "summary": "Définissez les barèmes et fenêtres de réinitialisation de votre équipe, les amendes automatiques, l'annulation et le PDF.",
      "body": [
        {
          "t": "p",
          "text": "Ouvrez **Outils membres → Equipes** (affiché comme **Equipe** si vous n'êtes que dans une seule équipe ; sur téléphone : **Plus → Outils membres → Equipes**), ouvrez votre équipe, touchez **Modifier l'equipe** et trouvez **Amendes** à la fin des **Paramètres d'équipe**. Seuls les coachs et responsables de l'équipe (ou les admins en mode admin) le voient."
        },
        {
          "t": "h",
          "text": "Catégories et barèmes"
        },
        {
          "t": "p",
          "text": "Chaque catégorie (**Inscription tardive**, **Absence**, **Retard de paiement**, **Autre**) dispose d'un interrupteur **Activé**, d'une **Fenêtre de réinitialisation** et de **Paliers d’escalade**."
        },
        {
          "t": "ul",
          "items": [
            "**Ajouter un palier**, puis définissez **Infraction n°** et **Montant**. Activez **Et toutes les suivantes** sur le dernier palier pour couvrir toutes les infractions ultérieures. Les montants sont enregistrés quand vous quittez le champ ; **Aperçu** affiche le barème.",
            "La **Fenêtre de réinitialisation** décide quand le décompte repart de zéro : **Mois calendaire**, **30 jours glissants**, **90 jours glissants**, **Saison (sept.–août)** ou **À vie**.",
            "Le numéro d'infraction compte les amendes antérieures du membre dans cette catégorie et cette équipe à l'intérieur de la fenêtre ; les amendes annulées ne comptent jamais."
          ]
        },
        {
          "t": "note",
          "text": "**Saison (sept.–août)** se réinitialise en réalité le 1er juin, lorsque l'application passe à la nouvelle saison."
        },
        {
          "t": "p",
          "text": "Pour **Inscription tardive** et **Absence**, activez **Par type d’activité** : **Entraînements**, **Matchs** et **Événements** reçoivent chacun leur propre interrupteur **Activé**, leur fenêtre et leurs paliers, et chacun compte ses propres infractions. Les barèmes démarrent comme des copies du barème général ; un type désactivé n'est pas sanctionné. Désactiver **Par type d’activité** supprime les paliers par type après une confirmation."
        },
        {
          "t": "h",
          "text": "Amendes automatiques pour inscription tardive"
        },
        {
          "t": "note",
          "text": "Activer une règle **Inscription tardive** (générale, ou la variante **Entraînements** ou **Matchs**) arme un balayage nocturne : chaque matin, tout joueur qui n'a pas répondu avant un délai échu est inscrit comme absent, sanctionné selon votre barème et notifié. Les événements ne sont jamais balayés."
        },
        {
          "t": "ul",
          "items": [
            "Seuls les entraînements et matchs à venir dont le délai est échu depuis moins de trois jours sont vérifiés.",
            "Le staff, les joueurs convoqués d'autres équipes et toute personne qui n'a pas pu répondre ne sont jamais sanctionnés ; les entraînements annulés faute de participants sont ignorés.",
            "Une règle sans paliers inscrit le joueur comme absent mais n'émet aucune amende.",
            "Si vous confirmez un joueur dans l'effectif après le délai, la fenêtre **Émettre une amende** s'ouvre préremplie avec **Inscription tardive** ; **Annuler** saute l'amende, la réponse reste enregistrée."
          ]
        },
        {
          "t": "h",
          "text": "Annuler et corriger"
        },
        {
          "t": "p",
          "text": "Le montant, la catégorie et le motif d'une amende émise ne peuvent pas être modifiés. Pour en corriger une, ouvrez **Finances → Finances d’équipe → Amendes d’équipe**, touchez **Annuler** et indiquez un **Motif de l’annulation** (obligatoire). Le membre est notifié, l'amende ne compte plus dans le barème et vous pouvez en émettre une nouvelle. Les amendes pour toute l'équipe ignorent le barème : vous saisissez donc le montant vous-même."
        },
        {
          "t": "tip",
          "text": "**Télécharger le récapitulatif (PDF)** dans le panneau **Amendes** génère une fiche pour l'équipe : totaux par membre (ouvertes, payées, annulées), chaque amende par ordre de date et les règles qui ont fixé les montants. Elle est toujours en anglais. La vue des membres est décrite dans la section Amendes."
        }
      ]
    },
    "formsauthoring": {
      "title": "Créer des formulaires",
      "summary": "Créez des formulaires pour votre équipe ou le club, publiez-les, relancez les retardataires et lisez les réponses.",
      "body": [
        {
          "t": "p",
          "text": "Les formulaires se trouvent sous **Outils membres → Formulaires** sur ordinateur et sous **Plus → Outils membres → Formulaires** sur téléphone ; seuls les coachs, les responsables d'équipe, les membres du comité et les admins voient cette entrée. Touchez **Nouveau formulaire** dans le tableau **Gérer les formulaires** pour commencer."
        },
        {
          "t": "h",
          "text": "Construire un formulaire"
        },
        {
          "t": "ol",
          "items": [
            "Saisissez un **Titre** et, si vous le souhaitez, une **Description**.",
            "Touchez **Ajouter un champ** pour chaque question, choisissez un type (**Texte court**, **Choix unique**, **Évaluation (1–5)**, **Téléversement de fichier** et d'autres) et cochez **Obligatoire** si une réponse est indispensable. Les options de choix se saisissent une par ligne.",
            "Réordonnez avec **Monter** / **Descendre** ; **Traduire** ajoute des libellés par langue.",
            "Sous **Équipes**, sélectionnez les équipes que vous dirigez ; seuls leurs membres verront le formulaire. Les membres du comité et les admins en **Mode admin** choisissent d'abord un **Public** (**Tout le club** ou **Équipes spécifiques**).",
            "Définissez **Clôture** pour fixer un délai : passé cette date et cette heure, plus aucun envoi n'est possible.",
            "Facultatif : **Anonyme** (les réponses ne sont pas liées à un membre), **Autoriser plusieurs réponses**, **Message de remerciement**.",
            "Utilisez **Aperçu** pour voir le formulaire tel que les membres le verront, puis **Enregistrer**."
          ]
        },
        {
          "t": "h",
          "text": "Publier et fermer"
        },
        {
          "t": "p",
          "text": "Un nouveau formulaire est un **Brouillon**, invisible pour les membres. Passez le **Statut** à **Ouvert** (ou touchez l'icône de cadenas, **Ouvrir**, dans **Gérer les formulaires**) pour le publier : les joueurs, coachs et responsables des équipes sélectionnées reçoivent une seule fois une notification cloche et push **Nouveau formulaire**. Les modifications ultérieures ne déclenchent pas de nouvelle notification. **Fermer** arrête les envois avant le délai ; la date de clôture le fait automatiquement."
        },
        {
          "t": "note",
          "text": "Supprimer un formulaire (icône de corbeille) supprime aussi toutes ses réponses, sans possibilité de retour en arrière. Fermez-le plutôt pour arrêter les nouvelles réponses."
        },
        {
          "t": "h",
          "text": "Réponses et rappels"
        },
        {
          "t": "p",
          "text": "L'icône de graphique à barres ouvre **Réponses** : une ligne par envoi, une colonne par question, plus un export CSV, Excel, JSON et PDF. Sauf si le formulaire est anonyme ou public, vous voyez aussi combien de membres ciblés ont répondu, qui manque encore, et **Relancer les non-répondants**, qui envoie un rappel cloche et push (pas d'e-mail ; au plus une fois par formulaire toutes les 10 minutes). Chaque nouvelle réponse vous est signalée par **Nouvelle réponse**."
        },
        {
          "t": "h",
          "text": "Formulaires pour tout le club et formulaires publics"
        },
        {
          "t": "p",
          "text": "Le public **Tout le club** et l'interrupteur **Formulaire public** nécessitent le **Mode admin** (membres du comité et admins). Un formulaire public reçoit une **Adresse web** et un **Lien public** que n'importe qui peut remplir sans se connecter. Les formulaires publics et anonymes n'ont ni suivi de progression ni rappels."
        },
        {
          "t": "h",
          "text": "Formulaires d'inscription aux événements"
        },
        {
          "t": "p",
          "text": "Les membres répondent aux événements dans l'application, pas via un formulaire (voir la section Événements). Pour les personnes sans compte, utilisez le **Lien d'inscription public** de l'événement (voir la section Gérer entraînements, matchs et événements). En **Mode admin**, les inscriptions des invités apparaissent sous **Toutes les inscriptions** avec **Exporter en CSV**, et vous pouvez joindre un **Formulaire d'inscription public** lors de la modification d'un événement."
        }
      ]
    },
    "hallbooking": {
      "title": "Plan de salle et temps de salle libre",
      "summary": "Lire la grille des salles, les types de créneaux et fermetures, et réclamer ou libérer du temps de salle libre.",
      "body": [
        {
          "t": "p",
          "text": "Ouvrez **Activités → Calendrier** (ordinateur) ou l'onglet **Calendrier** (téléphone) et passez la vue sur **Salle**. L'ordinateur affiche la semaine, le téléphone une journée ; **Aujourd'hui** ramène à la date du jour. Filtrez par sport (**VB** est présélectionné, **BB** ou **Tout**) ou par salle (puces sous la grille). Sur le téléphone, **Resume** montre toute la semaine d'un coup d'œil."
        },
        {
          "t": "h",
          "text": "Lire la grille"
        },
        {
          "t": "ul",
          "items": [
            "Les blocs portent leur type : **Entrainement**, **Match** ou **Evenement**. Un match à domicile bloque la salle dès 45 minutes avant le début ; un entraînement annulé est barré.",
            "Un bloc vert **Disponible** est du temps de salle libre : le créneau d'entraînement d'une équipe un jour où elle joue à l'extérieur, un entraînement annulé, un créneau libéré par les admins pour toutes les équipes, ou un créneau hebdomadaire sans entraînement planifié cette semaine-là (jusqu'à 12 semaines à l'avance).",
            "Un bloc **Reclame** (bordure pointillée) est un créneau disponible qu'une équipe a pris ; touchez-le pour voir **Reclame par** et **Reclame le**.",
            "Une superposition hachurée **Ferme** indique le motif : les créneaux de la salle disparaissent, ses entraînements sont annulés et aucun match à domicile ne peut y être réservé (voir la section Administration du plan de salle)."
          ]
        },
        {
          "t": "h",
          "text": "Réclamer du temps de salle libre"
        },
        {
          "t": "ol",
          "items": [
            "Touchez un bloc vert **Disponible**, ou le bouton vert **creneau(x) disponible(s)** et choisissez un horaire dans la liste **Creneaux disponibles**.",
            "**Reclamer du temps de salle** affiche la salle, la date, les heures, le **Motif** (**Entrainement annule**, **Match a l'exterieur** ou **Disponible**) et, sous **A l'origine**, l'équipe qui occupe normalement le créneau.",
            "Choisissez votre équipe sous **Pour l'equipe**, ajoutez des **Notes** facultatives et touchez **Reclamer**. Le bloc passe à **Reclame** pour tout le club."
          ]
        },
        {
          "t": "note",
          "text": "Les dates passées ne peuvent pas être réclamées (**Les creneaux passes ne peuvent pas etre reclames.**) et chaque créneau n'accepte qu'une réclamation par date : si quelqu'un a été plus rapide, vous voyez **Ce creneau a deja ete reclame.** Si l'équipe d'origine rétablit son entraînement annulé, votre réclamation est libérée automatiquement. Chaque réclamation et chaque libération est journalisée avec votre nom."
        },
        {
          "t": "tip",
          "text": "Lorsque vous créez un entraînement à cette date, le formulaire d'entraînement propose l'horaire comme **Creneau reclame** (voir la section Gérer entraînements, matchs et événements)."
        },
        {
          "t": "h",
          "text": "Libérer une réclamation"
        },
        {
          "t": "p",
          "text": "Touchez le bloc **Reclame**, puis **Liberer** dans **Details de la reclamation** et confirmez. Le bloc redevient **Disponible**. Seul un coach ou un responsable d'équipe de l'équipe qui a réclamé (ou un admin de ce sport en mode admin) peut le libérer."
        },
        {
          "t": "h",
          "text": "Trouver une salle municipale libre"
        },
        {
          "t": "p",
          "text": "La **Recherche de salles** liste les salles de sport de la ville de Zurich disposant d'un créneau récurrent libre sur toute la saison d'hiver, actualisées chaque nuit depuis l'outil de réservation de la ville. Filtrez par **Jour de la semaine**, **Dès**, **Durée min.**, **Arrondissement**, **Type de salle** et **Libre chaque semaine (hors vacances scolaires)**. **Calendrier** ouvre le plan d'occupation de la ville, **Demande** sa page de réservation, **Exporter en Excel** télécharge la liste."
        },
        {
          "t": "tip",
          "text": "Les coachs, responsables d'équipe et membres du comité n'ont pas d'entrée de menu : ouvrez directement `/admin/hallenfinder`. Les admins la trouvent sous **Admin → Planification & salles → Recherche de salles**."
        }
      ]
    },
    "teamabsences": {
      "title": "Absences et blocages d'équipe",
      "summary": "Voir qui est absent dans votre équipe, saisir des absences pour des joueurs et bloquer des dates pour la planification.",
      "body": [
        {
          "t": "p",
          "text": "En tant que coach ou responsable d'équipe, vous voyez les absences de votre équipe en un seul endroit. Ouvrez **Outils membres → Absences** (ordinateur) ou **Plus → Outils membres → Absences** (téléphone) et passez le sélecteur du bas de **Les miennes** à **Équipe**. Le sélecteur du haut permet de choisir **Absences** (ponctuelles) ou **Hebdomadaires** (indisponibilités récurrentes)."
        },
        {
          "t": "h",
          "text": "La vue équipe"
        },
        {
          "t": "ul",
          "items": [
            "Définissez la période avec **Du** et **Au**, restreignez le filtre d'équipe et utilisez **Filtrer par membre** pour masquer certains joueurs.",
            "Passez de la liste au calendrier mensuel avec les deux icônes à droite.",
            "**Masquer les indisponibilités** cache les indisponibilités hebdomadaires. **Masquer les absences non bloquantes** cache les absences dont l'interrupteur **Bloque la planification des matchs** est désactivé ; elles portent un badge **Non bloquant**.",
            "Dans le calendrier, les jours couverts par un blocage d'équipe sont grisés en rouge, comme les jours de fermeture de la salle."
          ]
        },
        {
          "t": "h",
          "text": "Saisir une absence pour un joueur"
        },
        {
          "t": "ol",
          "items": [
            "Dans la vue **Équipe**, touchez **Absence pour un membre**, ou sur **Hebdomadaire pour un membre** dans la vue **Hebdomadaires**.",
            "Choisissez le **Membre** (membres des équipes affichées dans le filtre d'équipe), les dates, le **Motif**, ce que l'absence **Concerne** et si elle **Bloque la planification des matchs**.",
            "Indiquez dans **Details (optionnel)** pourquoi vous la saisissez ; le joueur peut lire cette note."
          ]
        },
        {
          "t": "p",
          "text": "Le joueur reçoit une notification et la ligne est marquée comme modifiée par le coach ou le ou la responsable d'équipe, avec votre nom et la date. Comme pour toute absence, les réponses du joueur aux activités concernées sont automatiquement déclinées ; voir la section Absences."
        },
        {
          "t": "h",
          "text": "Blocages d'équipe"
        },
        {
          "t": "p",
          "text": "Un blocage d'équipe est un blocage strict pour la planification des matchs : aucun match n'est placé pour l'équipe à ces dates, à domicile comme à l'extérieur, même si seuls quelques joueurs sont absents. Dans la vue **Équipe**, sous **Absences**, le panneau **Blocages d'équipe** liste les blocages en cours et à venir. Touchez **Ajouter un blocage**, choisissez l'**Équipe**, **Du** et **Au**, ajoutez un **Motif (optionnel)** et enregistrez. Pour en supprimer un, touchez l'icône de corbeille (**Supprimer**) à côté et confirmez ; les blocages passés disparaissent d'eux-mêmes de la liste."
        },
        {
          "t": "note",
          "text": "Vous ne pouvez bloquer que les équipes dont vous êtes coach ou responsable. Les Spielplaner du club et les admins en mode admin peuvent aussi bloquer d'autres équipes. Un blocage à l'échelle du club est un réglage séparé ; voir la section Planification des matchs."
        },
        {
          "t": "h",
          "text": "Comment les absences parviennent à la planification des matchs"
        },
        {
          "t": "ul",
          "items": [
            "Seules les absences ponctuelles avec **Bloque la planification des matchs** activé et qui concernent **Matchs** ou **Tout** sont prises en compte. Les indisponibilités hebdomadaires et les absences des joueurs invités sont ignorées.",
            "Les deux premières propositions de date envoyées à un adversaire ne doivent comporter aucun joueur absent. La troisième proposition tolère une ou deux absences et est refusée à partir de trois.",
            "Un blocage d'équipe exclut complètement une date, quel que soit le nombre d'absences."
          ]
        },
        {
          "t": "tip",
          "text": "Les joueurs blessés ou absents pour longtemps devraient désactiver **Bloque la planification des matchs** sur leur absence, ou vous le faites pour eux, afin que le reste de l'équipe puisse quand même être planifié."
        }
      ]
    },
    "jsexport": {
      "title": "Export J+S",
      "summary": "Téléchargez les fichiers CSV Jeunesse+Sport des activités et des présences de votre équipe, prêts pour la NDS.",
      "body": [
        {
          "t": "p",
          "text": "**Export J+S** génère les deux fichiers CSV dont Jeunesse+Sport a besoin, les activités et les présences, pour une équipe et une saison, prêts à être importés dans la Nationale Datenbank Sport (NDS). Ouvrez-le via **Outils membres → Export J+S** sur ordinateur ou **Plus → Outils membres → Export J+S** sur le téléphone. Les coachs, responsables d'équipe, membres du comité et admins le voient ; il liste les équipes que vous dirigez (toutes les équipes actives lorsque le mode admin est activé)."
        },
        {
          "t": "h",
          "text": "Contenu des deux fichiers"
        },
        {
          "t": "ul",
          "items": [
            "**Activités** : chaque entraînement non annulé (comme Training), chaque match non annulé avec un adversaire et une heure de début (comme Wettkampf), et chaque événement d'équipe non annulé pour lequel **Pertinent pour J+S** est activé, avec le **Type d'activité J+S** choisi dans le formulaire de l'événement (Training, Wettkampf, Trainingstag ou Lagertag).",
            "**Présences** : une ligne par activité et par personne. Les joueurs de l'effectif comptent comme Teilnehmer/in, les coachs et responsables d'équipe comme Leiter/in ; les joueurs invités ne sont pas inclus. Toute personne ayant décliné une activité, ou ayant une absence couvrant sa date, est exclue."
          ]
        },
        {
          "t": "h",
          "text": "Saison et période"
        },
        {
          "t": "ul",
          "items": [
            "**Saison** va du 1er septembre au 31 août, l'année J+S. Par défaut, c'est la saison qui contient la date du jour ; pendant la pause estivale, il s'agit donc de celle que vous venez de terminer.",
            "**Du** et **Au** couvrent par défaut toute la saison. Restreignez-les pour contrôler quelles activités et quels événements sont inclus ; l'effectif reste celui de la saison sélectionnée."
          ]
        },
        {
          "t": "h",
          "text": "Téléchargement"
        },
        {
          "t": "ol",
          "items": [
            "Choisissez la **Saison** et, si nécessaire, **Du** et **Au**.",
            "Dans la ligne de l'équipe, touchez **Activités** pour télécharger le fichier des activités.",
            "Touchez **Présences** pour télécharger le fichier des présences."
          ]
        },
        {
          "t": "note",
          "text": "Dans la NDS, importez d'abord le fichier des activités, puis celui des présences. L'import des activités remplace toutes les activités et présences déjà saisies dans ce cours."
        },
        {
          "t": "h",
          "text": "Avertissements après un téléchargement"
        },
        {
          "t": "ul",
          "items": [
            "**Certaines personnes n'ont pas de numéro J+S et ont été ignorées** : les noms sont listés sous **Moniteurs** et **Joueurs**. Ils restent hors du fichier des présences tant que leur numéro personnel J+S n'est pas enregistré.",
            "**Certains entraînements n'ont ni lieu ni heure — J+S exige les deux et refuse le fichier sans eux** : les dates sont listées sous **Sans lieu** et **Sans heure**. Ajoutez la salle et l'heure de début (voir la section Gérer entraînements, matchs et événements), puis téléchargez à nouveau.",
            "**Aucun participant pour cette saison — l'export ne contient que des moniteurs/trices. Vérifiez la saison sélectionnée.** : l'effectif de l'équipe pour cette saison est vide. Le fichier se télécharge quand même, vérifiez donc la saison avant l'import."
          ]
        },
        {
          "t": "p",
          "text": "Les fichiers sont séparés par des points-virgules, en UTF-8, avec les dates au format dd.mm.yyyy et les heures au format HH:MM. Les règles J+S s'appliquent automatiquement : les matchs ne comportent ni heure, ni durée, ni lieu, chaque entraînement est déclaré à 90 minutes (J+S n'accepte que 60, 75 ou 90), un Trainingstag à 240 ou 300."
        },
        {
          "t": "tip",
          "text": "Les numéros J+S sont conservés par le club. Si une personne est ignorée, demandez à un admin d'enregistrer son numéro personnel J+S, puis téléchargez à nouveau les deux fichiers."
        }
      ]
    },
    "documents": {
      "title": "Pièces d'identité",
      "summary": "Photos d'identité chiffrées pour le jour du match : téléversement, qui peut les ouvrir et comment rétablir l'accès.",
      "body": [
        {
          "t": "p",
          "text": "Un joueur peut déposer une photo de sa carte d'identité ou de son passeport afin que son coach puisse la montrer à un arbitre avant un match. Elle est chiffrée sur l'appareil du joueur avant le téléversement ; seuls le joueur ainsi que les coachs et responsables d'équipe actuels de ses équipes peuvent l'ouvrir — ni le club, ni les administrateurs, ni le serveur. Gérez la vôtre sous **Mon profil** → **Modifier le profil** → **Pièce d'identité** (sur téléphone : **Plus**, puis la ligne de votre profil)."
        },
        {
          "t": "h",
          "text": "Votre clé de chiffrement"
        },
        {
          "t": "p",
          "text": "Votre clé est créée silencieusement à la connexion. Un appareil qui ne l'a jamais détenue vous demande votre mot de passe une seule fois (**Créer la clé** ou **Déverrouiller**) et conserve la clé jusqu'à ce que vous vous déconnectiez ou touchiez **Oublier ma clé sur cet appareil**. La déconnexion efface aussi les documents téléchargés pour un match."
        },
        {
          "t": "note",
          "text": "Utilisez **Changer le mot de passe** sous **Modifier le profil** — cela conserve votre clé. Un lien ou un code de réinitialisation la fait perdre : les documents partagés avec vous ne s'ouvrent plus, et le vôtre doit être téléversé à nouveau."
        },
        {
          "t": "h",
          "text": "Téléverser un document"
        },
        {
          "t": "ol",
          "items": [
            "Déverrouillez votre clé, touchez **Téléverser le document** et choisissez une photo ou un PDF (max 8 Mo).",
            "Pour une photo, déplacez, zoomez et pivotez-la dans **Ajuster votre document**, puis touchez **Utiliser cette photo**.",
            "La section affiche ensuite la date de téléversement avec **Afficher le document**, **Remplacer** et **Supprimer**."
          ]
        },
        {
          "t": "h",
          "text": "Qui peut ouvrir un document"
        },
        {
          "t": "p",
          "text": "L'accès est fixé au moment du téléversement pour les lecteurs qui possèdent déjà une clé ; quiconque crée sa clé plus tard n'a rien tant que l'accès n'est pas rétabli. Sous **Outils membres** → **Equipes**, ouvrez l'équipe : la colonne **ID** indique qui a un document, et depuis quand. **Accès aux documents**, à côté de **Effectif actuel**, ouvre **Qui peut ouvrir ces documents** — un état par membre de l'encadrement et par document :"
        },
        {
          "t": "ul",
          "items": [
            "**Peut ouvrir** — rien à faire.",
            "**Ne s'ouvrira pas** — sa clé a changé après le téléversement.",
            "**Pas encore de clé** — jamais accordé ; se corrige depuis la page de l'équipe.",
            "**Aucune clé d'identité créée** — la personne doit d'abord créer une clé ; personne ne peut le faire à sa place.",
            "**Ancien encadrement, a encore accès** — conserve la clé jusqu'à ce que le joueur remplace ou supprime le document."
          ]
        },
        {
          "t": "h",
          "text": "Rétablir l'accès"
        },
        {
          "t": "p",
          "text": "Une bannière au-dessus de l'effectif nomme les collègues qui ne peuvent pas ouvrir les documents. Touchez **Rétablir l'accès** : votre appareil transmet la clé pour chaque document que vous pouvez ouvrir vous-même. Rien n'est téléversé à nouveau ; personne en dehors de l'encadrement actuel des joueurs n'obtient l'accès. Votre propre clé doit être déverrouillée sur cet appareil ; sinon la bannière indique **Déverrouillez votre clé d'identité dans votre profil pour rétablir l'accès**. Les joueurs peuvent aussi combler l'écart eux-mêmes avec **Accorder l'accès** sur leur profil."
        },
        {
          "t": "tip",
          "text": "Le jour du match, ouvrez le match et utilisez **Afficher les documents d'identité** (dès 45 minutes avant le début ; voir la section Feuille de match). Vérifiez **Accès aux documents** la veille, pas à la salle."
        }
      ]
    },
    "spielplanung": {
      "title": "Planification des matchs",
      "summary": "Planifier les matchs de la saison avec les clubs adverses : créneaux, invitations, confirmations, Volleymanager et messagerie.",
      "body": [
        {
          "t": "p",
          "text": "La planification des matchs est une application séparée : **Admin → Planification & salles → Planification** sur ordinateur (les Spielplaner non admins voient un bouton **Planification**) ou **Plus → Planification** sur un téléphone ; votre connexion Wiedisync est reprise automatiquement. Les admins volleyball et les Spielplaner pour tout le club disposent de **Tableau de bord**, **Messagerie**, **Paramètres** et **Calendrier manuel des matchs** ; les Spielplaner par équipe, les coachs et les responsables d'équipe arrivent sur **Calendrier manuel des matchs** (en lecture seule pour les coachs et les responsables d'équipe)."
        },
        {
          "t": "h",
          "text": "Mettre en place une saison"
        },
        {
          "t": "ol",
          "items": [
            "Dans **Paramètres**, **Creer une nouvelle saison**, liez la saison SVRZ et définissez la **Date de reprise du flux**.",
            "Définissez les **Samedis de match**, choisissez les sources de créneaux de chaque équipe sous **Configuration par equipe**, puis **Generer les creneaux de match** (une régénération ne remplace que les créneaux non réservés).",
            "Réglez l'**Espacement des matchs (jours)** et les **Liens d’équipes** (admins volleyball uniquement) pour les équipes qui partagent des joueurs ou des coachs, puis **Ouvrir les reservations**.",
            "**Fermer les reservations** empêche de nouveaux adversaires de réserver ; les réservations existantes restent. **Archiver la saison** est réversible avec **Restaurer la saison** ; les invitations expirées restent expirées."
          ]
        },
        {
          "t": "h",
          "text": "Inviter les adversaires"
        },
        {
          "t": "p",
          "text": "Sous **Gérer les invitations**, **Importer depuis SVRZ** récupère les adversaires et leurs contacts ; **Envoyer les invitations** affiche chaque e-mail avant l'envoi. Les liens expirent le 30 juin de l'année de fin de la saison. L'adversaire choisit jusqu'à trois créneaux à domicile et propose jusqu'à trois dates à l'extérieur. Seul le premier choix est retenu ; les autres restent ouverts aux autres clubs."
        },
        {
          "t": "h",
          "text": "Confirmer les matchs"
        },
        {
          "t": "p",
          "text": "Dans le **Tableau de bord**, dépliez une équipe et ouvrez les **Reservations a domicile** ou les **Propositions a l'exterieur** d'un adversaire. Chaque proposition est revérifiée en direct et indique pourquoi elle ne convient plus. **Confirmer la proposition** réserve le créneau, envoie un e-mail à l'adversaire, lance l'optimisation des salles du samedi et transmet le match à domicile à Volleymanager. **Saisir un match convenu manuellement** enregistre un accord téléphonique sans e-mail. **Notifier les coachs** envoie le calendrier par e-mail ; une confirmation vous est demandée si des rencontres sont encore ouvertes."
        },
        {
          "t": "note",
          "text": "**Supprimer le match** libère le créneau mais laisse le match dans Volleymanager ; supprimez-le là-bas à la main. Les matchs qui diffèrent de Volleymanager sont signalés après la synchronisation nocturne ; utilisez **Renvoyer vers VM** ou **Synchroniser avec VM**."
        },
        {
          "t": "p",
          "text": "**Messagerie** est la boîte de réception partagée spielplanung@volleyball.kscw.ch : **Relever le courrier** la synchronise, les e-mails sont associés automatiquement aux adversaires, **Appartient à** rattache un fil à la main, et chaque confirmation y est copiée."
        },
        {
          "t": "h",
          "text": "Basketball (ProBasket)"
        },
        {
          "t": "p",
          "text": "Sous la pastille **Basketball**, le **Planificateur** prépare la Spielplansitzung ProBasket : **Placer un match** dans un créneau KWI libre ou **Ajouter un match à l’extérieur**, puis **Exporter l’équipe sélectionnée** ou **Exporter les équipes automatiques** (Lions D1 et Herren 1) ; les placements restent provisoires jusque-là. Dans **Réglages**, proposez des matchs à domicile sous **Matchs proposés aux adversaires** et envoyez un lien à chaque club sous **Clubs adverses** ; les dates cochées sont des disponibilités, pas des réservations."
        },
        {
          "t": "note",
          "text": "Les dates sont bloquées par **Dates bloquées (tout le club)** dans **Paramètres** (superadmin uniquement), par les blocages d'équipe sous **Absences de l'equipe** (voir la section Absences et blocages d'équipe) et par les fermetures de salle. Dans le **Calendrier manuel des matchs**, un jour bloqué pour tout le club (matchs à domicile), la même équipe deux fois le même jour ou un chevauchement de salle empêche l'enregistrement ; la même équipe à moins de deux jours d'intervalle ne déclenche qu'un avertissement."
        }
      ]
    },
    "hallenplanadmin": {
      "title": "Administration du plan de salle",
      "summary": "Salles, créneaux hebdomadaires, fermetures, synchronisation avec le calendrier de la gestion des salles et création des entraînements.",
      "body": [
        {
          "t": "p",
          "text": "Les admins entretiennent la grille des salles que les membres voient dans le calendrier. Ouvrez **Admin → Planification & salles → Plan de salle** (ordinateur) ou **Plus → Admin → Planification & salles → Plan de salle** (téléphone) et activez le **Mode admin** : les boutons **Fermetures** et **Salles** de la barre d'outils, ainsi que la modification des créneaux de n'importe quelle équipe, en ont besoin."
        },
        {
          "t": "h",
          "text": "Salles"
        },
        {
          "t": "p",
          "text": "**Gerer les salles** liste les lieux vers lesquels pointent chaque créneau, entraînement et match à domicile ; une salle doit exister ici avant qu'une équipe puisse y recevoir un créneau. **Ajouter une salle** demande un **Nom**, une **Adresse**, le nombre de **Terrains**, un **Lien carte** et l'indication **Homologuee** (autorisée pour les matchs de championnat). La suppression d'une salle affiche d'abord ce qui disparaît avec elle et ne peut pas être annulée."
        },
        {
          "t": "h",
          "text": "Créneaux et les entraînements qu'ils génèrent"
        },
        {
          "t": "ol",
          "items": [
            "Touchez une cellule vide de la grille pour **Nouveau creneau** ou sur un créneau existant pour **Modifier le creneau**.",
            "Choisissez la **Salle** (**KWI A+B** crée un créneau dans chacune des deux salles), l'**Equipe**, le **Jour de la semaine**, le **Type**, l'**Heure de debut** et l'**Heure de fin**.",
            "Un créneau **Recurrent** se répète chaque semaine entre **Valable du** et **Valable au**, ou **Indefiniment**.",
            "Cochez **Creneau d'entrainement libre** pour laisser le créneau sans équipe, afin que n'importe quel coach puisse le réclamer. **Chevauchement detecte :** signale d'autres créneaux dans la même salle."
          ]
        },
        {
          "t": "note",
          "text": "Un créneau de type **Entrainement** est un modèle. Son enregistrement crée les vrais entraînements : jusqu'à **Valable au** pour un créneau daté, environ 12 semaines à l'avance pour un créneau indéfini, complété chaque nuit. Modifier le créneau déplace ou raccourcit ses entraînements futurs ; le supprimer les supprime avec leurs inscriptions. Les entraînements passés ne sont jamais touchés."
        },
        {
          "t": "h",
          "text": "Fermetures"
        },
        {
          "t": "p",
          "text": "**Gerer les fermetures de salle** liste les jours où une salle est fermée. Une fermeture masque la salle dans le plan de salle, apparaît dans le calendrier et le flux iCal, y bloque les matchs à domicile et annule les entraînements ces jours-là ; supprimez-la et les entraînements reviennent. **Ajouter une fermeture** demande une ou plusieurs **Salles** (préréglages **KWI** et **Toutes les salles**), les dates **Du** et **Au**, un **Motif** et une **Source**."
        },
        {
          "t": "note",
          "text": "Utilisez **Admin** ou **Concierge** comme source pour une fermeture que vous saisissez vous-même. **Google Calendar** et **Vacances scolaires** appartiennent aux synchronisations automatiques, qui suppriment les lignes saisies à la main sous ces sources lors de leur prochain passage."
        },
        {
          "t": "h",
          "text": "Google Calendar et événements de salle"
        },
        {
          "t": "p",
          "text": "Chaque nuit, l'application se synchronise avec le calendrier Google de la gestion des salles KWI. Chacune de leurs entrées devient une fermeture des salles KWI (source **Google Calendar**) et s'affiche sur la grille comme événement de salle ; nos matchs à domicile au KWI sont inscrits dans leur calendrier. Sous **Calendrier de la gestion des salles**, marquez une entrée qui n'est pas une vraie fermeture comme **Pas de fermeture** et les entraînements qu'elle avait annulés reviennent ; **Fermer les salles** confirme une fermeture réelle. **Publier** envoie votre propre fermeture dans leur calendrier comme réservation du KSCW ; **Déjà chez eux** signifie qu'ils la couvrent déjà."
        },
        {
          "t": "tip",
          "text": "Les vacances scolaires de la ville de Zurich sont importées automatiquement comme fermetures de toutes les salles."
        }
      ]
    },
    "scorerassign": {
      "title": "Attribuer les services de marqueur",
      "summary": "Attribuer automatiquement les équipes de service aux matchs à domicile, les corriger à la main et suivre les inscriptions.",
      "body": [
        {
          "t": "p",
          "text": "Ouvrez **Admin → Opérations de match → Attribution des marqueurs** (ordinateur) ou **Plus → Admin → Opérations de match → Attribution des marqueurs** (téléphone). Vous devez disposer d'un accès admin volleyball ou basketball. La page couvre la **Saison** en cours. **Attribution** est l'onglet où vous planifiez ; **Vue d'ensemble** montre ce qui est enregistré sur les matchs."
        },
        {
          "t": "h",
          "text": "Lancer l'attribution automatique"
        },
        {
          "t": "ol",
          "items": [
            "Touchez **Lancer l'algorithme**. Un brouillon apparaît avec une ligne par match à domicile et une colonne **Notes** qui signale les conflits et les places libres.",
            "Corrigez les lignes avec **Selectionner l'equipe** et **Selectionner la personne** pour chaque service. Les lignes rouges n'ont pas d'équipe ; les matchs de coupe sont **De piquet** et ne reçoivent personne, sauf si vous choisissez quelqu'un.",
            "Touchez **Déployer** pour écrire les équipes de service et les personnes choisies sur les matchs. Ce n'est qu'à ce moment-là qu'elles sont officielles et visibles dans **Service de marqueur**."
          ]
        },
        {
          "t": "ul",
          "items": [
            "Au volleyball, le service dépend du niveau de l'équipe qui joue (Marqueur/Tableau combiné, marqueur séparé avec licence plus tableau, ou arbitre uniquement pour HU20) ; au basketball, une seule équipe de service par match.",
            "Les règles strictes excluent une équipe (propre match au même moment, un service le même jour, aucun membre avec la licence requise) ; les règles souples notent les autres à partir de 100 points. Dépliez **Règles de l'algorithme** pour voir les valeurs.",
            "Les matchs déjà attribués affichent **Attribution existante conservee** et restent inchangés, sauf si vous les modifiez."
          ]
        },
        {
          "t": "note",
          "text": "Le brouillon n'existe que dans votre navigateur (**Brouillon enregistré**) ; personne d'autre ne le voit tant que vous ne déployez pas. **Recalculer** le reconstruit à partir des matchs enregistrés et supprime les modifications non enregistrées. Déployer une nouvelle équipe de service efface une personne inscrite qui n'en fait pas partie."
        },
        {
          "t": "h",
          "text": "Résumé par équipe et crédits"
        },
        {
          "t": "p",
          "text": "**Resume par equipe** montre pour chaque équipe ses **Matchs**, ses services par rôle et le **Total**. **Arbitres** compte les licences d'arbitre comme des services déjà effectués (plafonné à 2). Saisissez un **Crédit** pour dispenser une équipe de services ; il est enregistré immédiatement, mais relancez l'algorithme pour l'appliquer."
        },
        {
          "t": "tip",
          "text": "**Télécharger Excel** exporte le brouillon et le résumé par équipe. Modifiez les colonnes d'équipe, puis **Importer corrigé** les réapplique, en associant les lignes par **N° match**."
        },
        {
          "t": "h",
          "text": "Après le déploiement : contrôle et modifications manuelles"
        },
        {
          "t": "p",
          "text": "L'onglet **Vue d'ensemble** liste chaque place de service enregistrée avec **Inscrit** et **Statut** ; filtrez avec **Afficher uniquement les places libres** ou **Inclure les matchs passés**. Pour modifier un service plus tard, ouvrez **Outils membres → Service de marqueur** avec le **Mode admin** activé : chaque carte de match à domicile propose **Selectionner l'equipe** et **Selectionner la personne**, et **Confirmé par** indique qui l'a pris et quand. Seuls les membres actifs éligibles sont proposés, et la modification est verrouillée dès le début du match."
        },
        {
          "t": "h",
          "text": "La composition du marqueur et l'Einsatzliste"
        },
        {
          "t": "p",
          "text": "Peu avant le début, le marqueur attribué reçoit un bouton **Composition** : la feuille de match enregistrée par le coach, sinon l'Einsatzliste déposée dans Volleymanager, sinon les joueurs confirmés. Les équipes de volleyball peuvent la déposer automatiquement environ une heure avant le début : **Envoyer automatiquement l'Einsatzliste** sous **Paramètres de match par défaut** dans l'éditeur de composition, modifiable par match avec **Einsatzliste automatique**. Voir les sections Feuille de match et Éditeur d'effectif."
        }
      ]
    },
    "registrations": {
      "title": "Inscriptions",
      "summary": "Traiter les nouvelles inscriptions au club : contrôle des données, documents, approbation, invitations et lien ClubDesk.",
      "body": [
        {
          "t": "p",
          "text": "Les nouvelles inscriptions arrivent depuis le formulaire du site kscw.ch. Ouvrez **Admin → Membres & communication → Inscriptions** (sur téléphone : **Plus → Admin → Membres & communication → Inscriptions**). Vous recevez aussi un e-mail par nouvelle inscription ; désactivez-le avec **Nouvelles inscriptions** sous **Notifications par e-mail** dans votre profil. La liste est regroupée en **Volleyball**, **Basketball** et **Passif** ; le filtre de statut affiche **En attente** par défaut, ou **Approuvée**, **Refusée** et **Tous les statuts**. Les admins de sport ne voient que leur sport, les admins globaux voient tout."
        },
        {
          "t": "h",
          "text": "Traiter une inscription"
        },
        {
          "t": "ol",
          "items": [
            "Touchez **Afficher les détails**, corrigez ce qui est erroné, puis **Enregistrer**.",
            "Regardez le badge de doublon : **Déjà membre**, **Ancien membre** ou **Doublon possible**. **Vérifier et fusionner** compare les deux fiches champ par champ ; **Fusionner N champ(s)** lie l'inscription à ce membre sans l'approuver.",
            "Vérifiez **Équipe** : à l'approbation, la personne rejoint l'effectif de chaque équipe active indiquée ici (une équipe reconnue s'affiche sous forme de puce). Une fonction de coach ou de responsable d'équipe n'est jamais attribuée automatiquement — utilisez ensuite l'éditeur d'effectif.",
            "**Approuver** ou **Refuser**. Un refus exige un **Motif**, que la personne reçoit par e-mail."
          ]
        },
        {
          "t": "note",
          "text": "Approuver une ligne signalée sans fusionner d'abord crée une seconde fiche de membre. Fusionnez, puis approuvez ou refusez."
        },
        {
          "t": "h",
          "text": "Ce que fait l'approbation"
        },
        {
          "t": "p",
          "text": "L'approbation crée ou lie la fiche de membre, envoie à la personne un lien à usage unique pour créer son compte (les coachs et responsables de l'équipe en copie) et avertit les admins du sport. Le contact ClubDesk est créé au prochain **Sync up** — ne le créez pas à la main. **Renvoyer l'invitation** sur une ligne approuvée envoie une nouvelle invitation."
        },
        {
          "t": "h",
          "text": "Documents basketball"
        },
        {
          "t": "p",
          "text": "Les inscriptions basketball doivent comporter leurs documents avant que **Approuver** n'aboutisse : toujours **Pièce d'identité (recto)**, **Pièce d'identité (verso)** et **Demande de licence** ; selon la **Situation de licence**, la nationalité et l'âge, aussi **Lettre de sortie (Freibrief)**, **Self declaration**, **National team decl.** et **Autorisation parentale (U18)**. **Attestation scolaire (facultative)** n'est jamais exigée. Les inscriptions volleyball et passives n'ont pas de contrôle de documents."
        },
        {
          "t": "ul",
          "items": [
            "**Téléverser** ou **Remplacer** un fichier vous-même : JPG, PNG, WebP ou PDF, max 10 MB.",
            "**Demander les documents** envoie à la personne un lien pour téléverser à nouveau (aussi sur les lignes approuvées ; le statut ne change jamais). Cochez plusieurs lignes et utilisez le bouton **Demander les documents** de la barre de sélection pour un envoi groupé. Modifiez le texte sous **Admin → E-mail du club → Modèles d'e-mail** ; son onglet **Envoyés** archive chaque e-mail envoyé à partir d'un modèle.",
            "**Approuver quand même** : indiquez un motif, puis **Lever et approuver**. La dispense porte votre nom et s'affiche comme **Documents levés**."
          ]
        },
        {
          "t": "h",
          "text": "Après l'approbation"
        },
        {
          "t": "ul",
          "items": [
            "**Statut de licence** : choisissez **Pas de licence**, **À commander**, **Commandée**, **Finalisée** ou **Licenciée** ; le membre est averti. **Licenciée** est normalement défini par la synchronisation Swiss Volley / Basketplan.",
            "**Sync ClubDesk** (admins globaux uniquement) : **Dans ClubDesk**, **Trouvé dans ClubDesk, mais pas encore lié** (utilisez **Lier**) ou **Pas dans ClubDesk** (utilisez **Synchroniser vers ClubDesk**).",
            "**CSV pour ClubDesk** télécharge les lignes cochées dans la disposition de colonnes de ClubDesk."
          ]
        }
      ]
    },
    "announcements": {
      "title": "Communication du club",
      "summary": "Publier les actualités du club, écrire à des groupes de membres avec des champs de fusion, et la messagerie partagée du club.",
      "body": [
        {
          "t": "p",
          "text": "Les actualités du club atteignent les membres dans l'application (carte Actualités, cloche) et, en option, par notification push ou par e-mail. **Écrire à un groupe** envoie un envoi groupé personnalisé depuis la messagerie partagée du club."
        },
        {
          "t": "h",
          "text": "Actualités du club"
        },
        {
          "t": "p",
          "text": "Ouvrez **Admin → Membres & communication → Annonces** (téléphone : **Plus → Admin → Membres & communication → Annonces**), puis **Nouveau post**."
        },
        {
          "t": "ul",
          "items": [
            "Rédigez un **Titre** et un texte dans chaque onglet de langue. L'allemand est obligatoire ; les membres lisent la langue de leur application, avec repli sur l'allemand.",
            "Ajoutez une **Image principale** (PNG, JPEG ou WebP, max 5 Mo) et un **Lien (optionnel)** commençant par https:// ou /.",
            "**Public** : **Tous les membres** (chaque membre actif de l'application), **Un sport**, **Équipes spécifiques** (joueurs, coachs, responsables d'équipe, capitaines) ou **Rôles et fonctions**. Les admins de sport ne peuvent cibler que leur propre sport ou ses équipes.",
            "**Épingler en haut de la carte Actualités** garde le post en première position ; après la **Date d’expiration (optionnel)**, il disparaît du fil.",
            "Cochez **Publier (visible immédiatement)** pour mettre en ligne. Ce n'est qu'ensuite que vous pouvez cocher **Envoyer une notification push** et **Envoyer un email** ; pour l'e-mail, choisissez la **Mise en page de l’e-mail** (**Standard** ou **Newsletter**) et une **Adresse de réponse** (vide signifie no-reply)."
          ]
        },
        {
          "t": "note",
          "text": "La publication n'envoie qu'une seule fois : chaque destinataire reçoit une entrée dans la cloche, la notification push et l'e-mail seulement si cochés. Les modifications ne renvoient jamais rien ; la suppression est irréversible. L'e-mail ignore les membres qui ont désactivé **Actualités du club** sous **Notifications par e-mail** dans leur profil, ainsi que les adresses en erreur."
        },
        {
          "t": "h",
          "text": "Messagerie du club"
        },
        {
          "t": "p",
          "text": "**Admin → E-mail du club → Messagerie du club** est la boîte partagée, réservée aux rôles admin et superutilisateur. Lisez la **Boîte de réception** et les **Envoyés**, touchez **Relever le courrier**, et utilisez **Nouvel e-mail**, **Répondre**, **Répondre à tous** ou **Transférer**. La **Signature** du club est ajoutée automatiquement. Un e-mail simple (**À** plus **Cc**) est une seule copie partagée de 50 adresses au maximum ; pour des listes plus longues, utilisez **Écrire à un groupe**."
        },
        {
          "t": "h",
          "text": "Écrire à un groupe"
        },
        {
          "t": "ol",
          "items": [
            "Touchez **Écrire à un groupe** et choisissez des groupes sous **Affiliation**, **Sections**, **Joueurs**, **Rôles et fonctions**, **Équipes** ou **Anciens membres**, en les limitant si besoin par **Saison**. **Afficher les personnes individuellement** déplie un groupe pour retirer des personnes une à une ; **Coller une liste d’adresses** permet d'en ajouter.",
            "L'aperçu indique combien de membres recevront l'e-mail et combien sont ignorés (pas d'adresse e-mail, désabonnés, adresse partagée, adresse en erreur).",
            "Rédigez le sujet et le message. `{{vorname}}` et `{{nachname}}` (ou `{{first_name}}`, `{{last_name}}`) deviennent le nom de chaque destinataire ; `{{name}}`, `{{email}}`, `{{beitragskategorie}}`, `{{mitgliederbeitrag}}` et `{{team}}` fonctionnent aussi. Les champs inconnus sont barrés et envoyés tels quels.",
            "Touchez **Voir le message** pour le lire tel que trois vrais destinataires le verront, puis sur **Envoyer à** et confirmez."
          ]
        },
        {
          "t": "note",
          "text": "Chaque destinataire reçoit sa propre copie, personne ne voit les autres adresses, et l'envoi ne peut pas être annulé. **Cc** et **Cci** reçoivent une seule copie partagée (50 adresses au maximum). **Affiliation** désigne toutes les personnes du registre du club, pas seulement les utilisateurs de l'application. Les membres se désabonnent avec l'interrupteur **Actualités du club** dans leur profil ; les e-mails de groupe contiennent aussi un en-tête de désabonnement, et ces demandes sont traitées à la main."
        }
      ]
    },
    "clubfinance": {
      "title": "Finances du club",
      "summary": "Cotisations, factures, rappels, comptabilité, budget, membres, notes de frais et versements pour la finance et le comité.",
      "body": [
        {
          "t": "p",
          "text": "**Finances du club**, sous **Finances → Finances du club** (**Plus** d'abord sur un téléphone), s'adresse au rôle finance et au comité. Choisissez d'abord l'**Exercice** ; la plupart des onglets s'y réfèrent."
        },
        {
          "t": "h",
          "text": "Facturation"
        },
        {
          "t": "ul",
          "items": [
            "**Cotisations** : définissez les **Tarifs de cotisation** par catégorie, cochez les catégories, choisissez une **Échéance**, touchez **Aperçu**, puis sur **Émettre … factures**. Chaque membre reçoit une QR-facture ; les coachs, le comité et les membres d'honneur reçoivent une facture de CHF 0.00 indiquant l'exonération. Les campagnes passées proposent **Télécharger les factures**, **E-mail** et **Annuler la campagne**.",
            "**Factures** : les factures de la saison, natives et reprises de ClubDesk. **Nouvelle facture** facture un membre, une équipe ou un contact externe. Par ligne : **Confirmer** un paiement, **Paiements** (paiements partiels, notes de crédit, remboursements, amortissements), **Annuler** ou **Relier à un membre**. **Rapprochement bancaire (camt)** confirme les factures à partir d'un export bancaire.",
            "**Rappels** : les factures Wiedisync en retard. Envoyez les rappels 1 à 3 dans l'ordre, avec si vous le souhaitez des **Frais de rappel (CHF)** et un e-mail ; **Ne jamais rappeler** exclut un membre. Rien n'est automatique."
          ]
        },
        {
          "t": "note",
          "text": "L'émission n'envoie jamais d'e-mail — utilisez **E-mail** sur la campagne. L'envoi démarre en mode test : chaque message part vers le destinataire de test jusqu'à ce que vous touchiez **Désactiver (passer en réel)** et saisissiez le nombre de membres. **Annuler la campagne** annule les factures encore ouvertes ; les factures payées restent."
        },
        {
          "t": "h",
          "text": "Comptabilité et rapports"
        },
        {
          "t": "ul",
          "items": [
            "**Aperçu**, **Compte de résultat**, **Bilan** et **Comptes** reflètent la comptabilité ClubDesk, actualisée chaque nuit à 04:00 ou via **Synchroniser maintenant**. **Exporter** sur le compte de résultat et le bilan donne un PDF, un fichier Excel ou PowerPoint.",
            "**Budget** : budget et réel par compte ; un budget saisi s'enregistre tout seul.",
            "**Comptabilité** : le livre en partie double propre à Wiedisync — **Journal**, **Comptes**, **Balance des soldes**, **Clôture de l’exercice**, **Écritures automatiques**. Associez les comptes collectifs, puis activez **Créer les écritures automatiquement**."
          ]
        },
        {
          "t": "h",
          "text": "Dossiers"
        },
        {
          "t": "ul",
          "items": [
            "**Membres** : IBAN, catégorie, coordonnées et factures par membre ; **Facturer un autre contact** pour les mineurs ou les entreprises, **Joindre un PDF**, ou **Afficher le QR de versement** puis **Enregistrer et télécharger** pour rembourser à la main. Seul le rôle finance (ou un admin en mode admin) peut modifier ici.",
            "**Équipes** : sponsoring, recettes et dépenses par équipe via **Ajouter une entrée**, plus le **Remboursement arbitrage** de fin de saison : **Aperçu**, puis **Créer les versements**, un par membre. Sans IBAN suisse ou liechtensteinois, ou sans code postal et localité : ignoré et listé.",
            "**Notes de frais** : les justificatifs téléversés par les membres. Passez-les à **Payée** ou **Refusée** — le membre est averti dans l'application, par notification push et par e-mail avec votre **Note au membre** ; **Payée** crée aussi le versement. La **Note interne** reste cachée."
          ]
        },
        {
          "t": "p",
          "text": "**Confirmer les dépenses** (**Finances → Finances du club**) permet aux admins de section et à la finance de confirmer qu'un remboursement est budgété et de cocher **La section a déjà remboursé le membre** ; cela ne change jamais le statut du membre. **Frais d'arbitrage** (**Admin → Opérations de match**) liste les frais d'arbitrage enregistrés par équipe de volleyball et par saison, avec **Export CSV**."
        },
        {
          "t": "note",
          "text": "Un exercice clôturé refuse toute modification (confirmations, annulations, entrées d'équipe, la campagne d'arbitrage) ; corrigez dans un exercice ouvert. Chaque modification est consignée sous votre nom. Côté membres : voir les sections Factures et remboursements et Finances d'équipe."
        }
      ]
    },
    "explorer": {
      "title": "Base de données et atelier SQL",
      "summary": "Parcourir, filtrer et modifier les données des membres dans la Base de données, et exécuter des requêtes dans l'Atelier SQL.",
      "body": [
        {
          "t": "p",
          "text": "La page **Base de données** est la vue admin de chaque membre, équipe, événement, entraînement et match. Ouvrez-la via **Admin → Données & analyses → Base de données** (ordinateur) ou **Plus → Admin → Données & analyses → Base de données** (téléphone). Les admins de sport voient leur propre sport ; les admins du club voient tout."
        },
        {
          "t": "h",
          "text": "Trouver des personnes"
        },
        {
          "t": "ul",
          "items": [
            "**Tout rechercher…** cherche dans toutes les catégories à la fois.",
            "**Filtres** restreint les membres par sport, genre, positions, licences, rôles, statut d'adhésion, cotisation payée et plus encore. Par défaut, seuls les membres avec **Adhésion KSCW active** sont affichés ; modifiez ce filtre pour voir les anciens membres ou les membres passifs.",
            "**Donnée** sélectionne un ou plusieurs champs : le détail n'affiche que ceux-ci, le tableau les ajoute comme colonnes. **Afficher tous les champs** annule la sélection.",
            "Basculez entre **Arborescence** et **Tableau** avec le sélecteur **Vue**. Le tableau propose **Colonnes**, **Grouper par** et **Exporter** au format **Excel (.xlsx)** ou **PDF**, toujours avec des en-têtes en anglais."
          ]
        },
        {
          "t": "h",
          "text": "Modifier des membres"
        },
        {
          "t": "p",
          "text": "Ouvrez un membre depuis l'arborescence ou avec **Ouvrir les détails** dans le tableau. **Tous les champs** liste chaque colonne par thème ; les colonnes vides et techniques restent masquées jusqu'à ce que vous touchiez **Afficher les champs vides** ou **Afficher les champs techniques**. Touchez **Modifier**, changez ce dont vous avez besoin et **Enregistrer**. Chaque enregistrement n'écrit que les champs modifiés et est consigné dans l'audit. Les rôles et les droits Spielplaner ne peuvent être modifiés que par un admin du club. Un champ marqué **Écrasé par la synchronisation** est modifiable, mais la prochaine synchronisation remplacera votre valeur."
        },
        {
          "t": "p",
          "text": "Pour plusieurs membres, cochez des lignes dans le tableau et choisissez **Bulk edit**. Ajoutez des données avec **Set value**, **Clear**, **Add** ou **Remove** et appliquez-les à tous les membres sélectionnés ; les membres qui ont déjà la valeur sont ignorés. **Mark as departed** met fin à l'adhésion de toutes les personnes sélectionnées avec un seul statut et une seule date de sortie."
        },
        {
          "t": "note",
          "text": "Les modifications groupées ne peuvent pas être annulées. Lisez l'aperçu indiquant combien de membres seront modifiés avant d'appliquer."
        },
        {
          "t": "h",
          "text": "Zone de danger"
        },
        {
          "t": "p",
          "text": "En bas du détail d'un membre, **Zone de danger** bascule immédiatement **Affiliation au club** et **Accès à l’application**. Quand quelqu'un quitte le club, utilisez **Member left** : cela définit le statut du registre et la date de sortie, désactive l'affiliation et l'accès à l'application, et retire les effectifs de la saison en cours. **Supprimer définitivement** affiche d'abord tous les enregistrements dépendants et vous demande de saisir DELETE. Le contact ClubDesk n'est jamais supprimé."
        },
        {
          "t": "note",
          "text": "Désactiver **Affiliation au club** n'est pas une sortie : aucune date de sortie n'est définie et rien n'est transmis à ClubDesk. Utilisez plutôt **Member left**."
        },
        {
          "t": "h",
          "text": "Atelier SQL (superadmins)"
        },
        {
          "t": "p",
          "text": "**Admin → Superadmin → Atelier SQL** exécute des requêtes en lecture seule ; touchez **Exécuter** ou Ctrl/Cmd-Entrée. Les résultats sont limités à 1000 lignes et s'exportent en **CSV** ou **Excel**. Vos 20 dernières requêtes restent sous **Récentes** (dans ce navigateur uniquement). **Demander à l'IA** transforme une demande en langage courant en SQL et conserve les questions récentes dans **Mémoire**, de sorte qu'une question de suivi affine la même requête. N'activez le **Mode écriture** que pour modifier des données. Chaque exécution est journalisée avec le SQL et votre nom."
        }
      ]
    },
    "admintools": {
      "title": "Outils admin",
      "summary": "Où se trouve chaque page admin, à quoi elle sert et comment le mode admin change ce que vous voyez.",
      "body": [
        {
          "t": "p",
          "text": "Les pages admin se trouvent sous **Admin** dans la barre supérieure sur ordinateur, ou sous **Plus → Admin** sur un téléphone. **Tous les outils admin** ouvre un tableau consultable de toutes les pages que vous pouvez ouvrir, avec **Section** et **Accès** (**Admin**, **Admin du club** ou **Superadmin**)."
        },
        {
          "t": "h",
          "text": "Mode admin"
        },
        {
          "t": "p",
          "text": "Le **Mode admin** sous **Options** change la portée des données, pas le menu : activé, toutes les équipes apparaissent dans le calendrier, les matchs, les entraînements, les événements et les absences, et les admins de sport obtiennent les pouvoirs d'un coach sur les pages d'équipe ; désactivé, vous voyez ce qu'un membre voit. Les pages admin s'ouvrent dans les deux modes. L'interrupteur, la bannière dorée et la variante pour les membres du comité sont décrits dans la section S'orienter dans l'application."
        },
        {
          "t": "h",
          "text": "Les pages admin"
        },
        {
          "t": "ul",
          "items": [
            "**Planification & salles** : **Planification** (voir la section Planification des matchs), **Plan de salle** avec les salles et les fermetures (voir la section Administration du plan de salle) et **Recherche de salles** (salles libres de la ville).",
            "**Opérations de match** : **Attribution des marqueurs** (voir la section Attribuer les services de marqueur) ; **Arbitres volley** associe les arbitres aux équipes qu'ils couvrent (la synchronisation hebdomadaire réajoute les arbitres licenciés) ; **Frais d'arbitrage** (lecture seule).",
            "**Membres & communication** : **Inscriptions** et **Annonces** (sections dédiées) ; **Transferts** pour les transferts internationaux (**Vérifier VIS maintenant** interroge la FIVB) ; **Feedback volley**, les résultats des sondages.",
            "**E-mail du club** : **Messagerie du club** (admins du club uniquement), **Modèles d'e-mail**, **Garage des e-mails** avec chaque boîte e-mail du club et son mot de passe.",
            "**Données & analyses** : **Base de données** (voir la section Base de données et atelier SQL) et **Statistiques** (effectifs, licences, couverture des marqueurs)."
          ]
        },
        {
          "t": "h",
          "text": "Outils superadmin"
        },
        {
          "t": "ul",
          "items": [
            "**Infrastructure** : état des services, des synchronisations et des tâches planifiées ; **Lancer maintenant** démarre une synchronisation en avance, mais Volleymanager et SVRZ ne tournent jamais en même temps.",
            "**Qualité des données** : l'onglet **ClubDesk sync** suit le parcours guidé (de **1. Sync down** à **5. Fix groups**) avec **Do the next step** ; chaque différence attend votre décision (**ClubDesk** ou **Wiedisync** l'emporte). **Tout le club** analyse les matchs, les membres, les cotisations et les licences de marqueur, avec **Tout corriger**.",
            "**Ménages** (voir la section Ménages et comptes familiaux).",
            "**Audit log** : modifications de données, connexions et événements système, sur 90 jours.",
            "**Journal des erreurs** : erreurs en direct de l'application et du site web, avec **Archiver**, **Important** et **Mettre en sourdine tous les cas de ce type** pour le tri.",
            "**Atelier SQL** (voir la section Base de données et atelier SQL) et **Bugfixes** : **Corriger** lance une correction automatisée, **Déployer sur Dev** et **Déployer sur Prod** la mettent en ligne ; les corrections livrées apparaissent sous **Options → Statut**."
          ]
        },
        {
          "t": "h",
          "text": "Rôles, licences et équipes"
        },
        {
          "t": "p",
          "text": "Les rôles et le drapeau Spielplaner à l'échelle du club se définissent sur le membre dans **Base de données**, sous **Roles & access**, par les admins du club uniquement. Le statut de licence (de **Pas de licence** à **Licenciée**) s'y modifie aussi ; **Licenciée** provient normalement de la synchronisation Swiss Volley / Basketplan, qui ne rétrograde jamais. Les équipes ne se créent pas dans l'application ; le staff se rattache avec **Gérer le staff** sur la page d'équipe en mode admin (voir la section Éditeur d'effectif)."
        },
        {
          "t": "note",
          "text": "Les actions de la zone de danger, l'affichage des mots de passe et **Voir en tant que ce membre** sont enregistrés dans l'**Audit log** sous votre nom ; les exécutions SQL le sont aussi. Les modifications en masse, **Member left** et les suppressions ne peuvent pas être annulées."
        }
      ]
    }
  }
}
