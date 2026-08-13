export default {
  // Privacy Policy page
  privacyTitle: 'Politique de confidentialite',
  lastUpdated: 'Derniere mise a jour : 4 avril 2026',

  controllerTitle: '1. Responsable du traitement',
  controllerText:
    'KSC Wiedikon\nSchrennengasse 7\n8003 Zürich\nEmail : kscw@kscw.ch',

  dataCollectedTitle: '2. Donnees collectees',
  dataAccountTitle: 'Donnees de compte (lors de l\'inscription)',
  dataAccountText:
    'Lors de l\'inscription en tant que membre du club, nous collectons : nom, adresse email, numero de telephone et date de naissance. Les photos de profil sont telechargees et gerees par les membres eux-memes. Le numero de licence, le poste et l\'attribution d\'equipe sont definis par les entraineurs ou le comite.',
  dataRosterTitle: 'Donnees d\'effectif (publiques)',
  dataRosterText:
    'Sur les pages d\'equipe accessibles au public, les noms des joueurs, numeros de maillot, postes et photos sont affiches. Ces informations correspondent aux donnees egalement publiees publiquement par Swiss Volley.',
  dataInternalTitle: 'Donnees internes du club',
  dataInternalText:
    'La presence aux entrainements, les absences (y compris le motif), les attributions de marqueur et les resultats des matchs sont enregistres en interne pour la gestion du club et ne sont visibles que par les membres connectes ou les entraineurs.',
  dataTechnicalTitle: 'Donnees techniques',
  dataTechnicalText:
    'Lors de la visite du site web, des informations techniques telles que l\'adresse IP et les informations du navigateur sont automatiquement traitees par notre hebergeur (Cloudflare).',

  dataRegisterTitle:
    'Données de base pour l’administration et les fédérations',
  dataRegisterText:
    'Pour l’administration du club et l’inscription auprès des fédérations, nous enregistrons également l’adresse postale, le NPA et la localité, la nationalité, le sexe, le numéro AVS ainsi que — pour les entraîneurs de la relève — le numéro de personne J+S. Le numéro AVS est requis pour les annonces aux fédérations et à J+S et n’est visible que par le comité et l’administration.',
  dataFinanceTitle:
    'Données de paiement et de facturation',
  dataFinanceText:
    'Pour facturer les cotisations, nous enregistrons la catégorie de cotisation, l’adresse de facturation et les coordonnées bancaires (IBAN). Ces données ne sont visibles que par le comité et l’administration des finances.',
  dataIdentityTitle:
    'Documents d’identité (chiffrés de bout en bout)',
  dataIdentityText:
    'Certaines fédérations exigent une copie d’une pièce d’identité pour la licence de jeu. Elle est chiffrée dans le navigateur du membre (AES-256-GCM) et ne parvient à notre serveur que sous forme chiffrée; la clé est encapsulée séparément pour les personnes autorisées. Ni l’exploitant du serveur ni l’administration ne peuvent lire le fichier sans cette clé.',

  legalBasisTitle: '3. Base juridique',
  legalBasisText:
    'Le traitement des donnees personnelles repose sur :',
  legalBasisContract:
    'Execution du contrat (adhesion au club) — pour la gestion des donnees des membres, des entrainements et de la planification des matchs.',
  legalBasisInterest:
    'Interet legitime — pour l\'affichage public des effectifs d\'equipe, comme c\'est l\'usage dans le sport associatif et attendu par les membres.',
  legalBasisConsent:
    'Consentement — Les membres telechargent leur propre photo de profil et peuvent la modifier ou la supprimer a tout moment.',

  thirdPartyTitle: '4. Sous-traitants',
  thirdPartyIntro: 'Les prestataires suivants sont utilises comme sous-traitants :',
  thirdPartyCloudflare:
    'Cloudflare, Inc. — Hebergement frontend (Cloudflare Pages) | Mondial (siege aux USA) | DPA, Clauses contractuelles types, Swiss-US Data Privacy Framework',
  thirdPartySwissVolley:
    'API Swiss Volley (api.volleyball.ch) — Nous recuperons des donnees de matchs et classements accessibles au public. Aucune donnee personnelle n\'est transmise a Swiss Volley.',
  thirdPartyGCal:
    'Google Calendar — Nous recuperons un flux de calendrier public pour afficher les horaires de salle. Aucune donnee personnelle n\'est transmise a Google.',
  thirdPartyBasketplan:
    'Basketplan (basketball.ch) — Nous recuperons des donnees de matchs et classements accessibles au public. Aucune donnee personnelle n\'est transmise a Basketplan.',
  thirdPartyMigadu:
    'Migadu (migadu.com) — Envoi d\'emails pour les notifications et rappels | Suisse | DPA',
  thirdPartyHetzner:
    'Hetzner Online GmbH — Hebergement backend (Directus) | Allemagne (centre de donnees de Nuremberg) | DPA, conforme au RGPD',
  thirdPartyClubDesk:
    'ClubDesk (administration de club, Suisse): les données de base des membres, y compris les coordonnées, le numéro AVS et les coordonnées bancaires, sont synchronisées avec ClubDesk, d’où provient la majeure partie de ces données.',
  thirdPartySentry:
    'Sentry (sentry.io) — Suivi des erreurs et monitoring de performance | UE (de.sentry.io, Allemagne) | DPA, conforme au RGPD. Aucune donnee personnelle (nom, email) n\'est transmise a Sentry.',
  thirdPartyCloudflareWorkers:
    'Cloudflare Workers — Traitement des notifications push | Mondial (siege aux USA) | DPA, Clauses contractuelles types, Swiss-US Data Privacy Framework',

  retentionTitle: '5. Conservation des donnees',
  retentionText:
    'Vos donnees personnelles sont conservees tant que vous disposez d\'un compte actif sur la plateforme. Sur demande ou a la fin de votre adhesion, vos donnees seront supprimees dans un delai de 30 jours, sauf si une duree de conservation plus longue est exigee par la loi. Vous pouvez egalement supprimer votre compte a tout moment directement dans les parametres de votre profil.',

  storageTitle: '6. Stockage des donnees',
  storageServer:
    'Les donnees sont stockees sur un serveur de Hetzner Online GmbH en Allemagne (centre de donnees de Nuremberg) avec Directus. Le frontend est servi via Cloudflare Pages.',
  storageLocal:
    'Les preferences non personnelles suivantes sont stockees dans votre navigateur : schema de couleurs (clair/sombre) et parametre de langue. Pour les utilisateurs connectes, un jeton de session est stocke dans le navigateur.',
  storageNoCookies:
    'Le site web lui-meme ne place aucun cookie. Cloudflare peut placer des cookies techniquement necessaires qui ne requierent pas de consentement.',

  rightsTitle: '7. Vos droits',
  rightsText:
    'En vertu de la loi suisse sur la protection des donnees (nLPD), vous disposez des droits suivants :',
  rightsAccess: 'Droit d\'acces — Vous pouvez demander des informations sur vos donnees stockees.',
  rightsCorrection: 'Droit de rectification — Vous pouvez demander la correction de donnees inexactes. La plupart des donnees peuvent etre mises a jour directement dans votre profil.',
  rightsDeletion: 'Droit a l\'effacement — Vous pouvez demander la suppression de vos donnees, ou supprimer votre compte vous-meme.',
  rightsPortability: 'Droit a la portabilite — Vous pouvez recevoir vos donnees dans un format couramment utilise.',
  rightsObject: 'Droit d\'opposition — Vous pouvez vous opposer au traitement de vos donnees a tout moment.',
  rightsContact:
    'Pour toute demande concernant vos droits, veuillez contacter : kscw@kscw.ch',
  rightsFDPIC:
    'Vous avez egalement le droit de deposer une plainte aupres du Prepose federal a la protection des donnees et a la transparence (PFPDT) : www.edoeb.admin.ch',

  photosTitle: '8. Photos',
  photosText:
    'Les photos des joueurs sont telechargees par les membres eux-memes via leur profil et peuvent etre modifiees ou supprimees a tout moment. Les photos telechargees sont visibles sur les pages d\'equipe publiques.',

  messagingTitle: '9. Messagerie',
  messagingIntro:
    'Depuis avril 2026, la plateforme propose un systeme de messagerie integre pour les discussions d\'equipe, les messages prives, les sondages et la moderation. L\'utilisation est facultative et necessite un consentement explicite.',
  messagingDataTitle: 'Ce que nous stockons',
  messagingDataText:
    'Dans le cadre du systeme de messagerie, nous collectons et stockons : messages envoyes (texte), reactions (emoji), signalements (y compris une capture du message signale au moment du signalement), appartenances aux conversations, listes de blocage, decisions de consentement, et abonnements push si vous avez active les notifications.',
  messagingRetentionTitle: 'Duree de conservation',
  messagingRetentionText:
    'Les messages sont automatiquement et definitivement supprimes apres 12 mois. Les messages supprimes par un utilisateur sont definitivement retires apres 30 jours supplementaires (ils sont deja invisibles durant cette periode mais restent accessibles pour les signalements). Les demandes de message refusees sont retirees apres 90 jours. Les signalements sont conserves pendant toute la duree du compte pour garantir la tracabilite des decisions de moderation.',
  messagingAccessTitle: 'Qui y a acces',
  messagingAccessText:
    'Les messages ne peuvent etre lus que par vous et les autres membres de la meme conversation. Les administrateurs du club ont acces aux messages signales (y compris la capture) pour examen et moderation. L\'administration de la base de donnees (actuellement : Luca Canepa) dispose, en tant qu\'operateur de l\'infrastructure, d\'un acces technique a l\'ensemble de la base de donnees. Les messages ne sont pas chiffres de bout en bout ; ils sont stockes non chiffres sur un serveur Hetzner en Allemagne, proteges par TLS en transit, authentification par cle SSH et un pare-feu au niveau de la base de donnees.',
  messagingRightsTitle: 'Vos droits et parametres',
  messagingRightsText:
    'Vous pouvez activer ou desactiver la messagerie a tout moment sous Options → Messagerie (chat d\'equipe et messages prives separement). Depuis la meme page, vous pouvez exporter vos donnees de messagerie au format JSON (au maximum 1× toutes les 24 heures). La suppression de votre compte entraine la suppression en cascade de vos messages, reactions, blocages, appartenances aux conversations et demandes. Les signalements dans lesquels vous apparaissez comme auteur du signalement ou personne signalee sont anonymises (references mises a NULL), tandis que le contenu de la capture est conserve a des fins de documentation.',
  messagingReportsTitle: 'Signalements et moderation',
  messagingReportsText:
    'Les membres peuvent signaler des messages inappropries. Un signalement stocke une capture du message signale (afin que des modifications ou suppressions ulterieures ne compromettent pas la moderation) et est transmis aux administrateurs pour examen. Les administrateurs peuvent supprimer des messages, marquer un signalement comme traite ou — dans les cas graves — interdire a un membre individuel l\'usage de la messagerie.',
  messagingPushTitle: 'Notifications push',
  messagingPushText:
    'Les notifications push pour les nouveaux messages sont facultatives et desactivees par defaut. Sous Options → Messagerie, vous pouvez choisir si les notifications s\'affichent de maniere generique ("Nouveau message") ou incluent le nom de l\'expediteur et un bref apercu du texte. La livraison est effectuee via Cloudflare Workers (voir section 4).',

  changesTitle: '10. Modifications',
  changesText:
    'Nous nous reservons le droit de mettre a jour cette politique de confidentialite en cas de besoin. La version actuelle est disponible sur cette page.',

  // Impressum page
  impressumTitle: 'Mentions legales',
  impressumClubName: 'KSC Wiedikon',
  impressumAddress: 'Schrennengasse 7\n8003 Zurich',
  impressumFullName: 'Kultur- und Sportclub Wiedikon',
  impressumContact: 'Email : kscw@kscw.ch',
  impressumWebsite: 'Site web : kscw.ch',
  impressumBoard: 'Responsable : Comite du KSC Wiedikon',
  impressumHosting: 'Hebergement : Cloudflare Pages (frontend), Hetzner Online GmbH, Allemagne (backend)',
  impressumLinks: 'Responsabilite pour les liens',
  impressumLinksText:
    'Notre site contient des liens vers des sites web externes de tiers sur le contenu desquels nous n\'avons aucune influence. Le fournisseur respectif est toujours responsable du contenu des pages liees. En cas de connaissance de violations legales, nous supprimerons immediatement ces liens.',
  impressumCopyright: 'Droit d\'auteur',
  impressumCopyrightText:
    'Les contenus et oeuvres crees par le KSC Wiedikon sur ce site web sont soumis au droit d\'auteur suisse. La reproduction, le traitement ou la diffusion en dehors des limites du droit d\'auteur necessite le consentement ecrit du club.',
  impressumSocial: 'Reseaux sociaux',
  impressumFacebook: 'Facebook : KSC Wiedikon',
  impressumInstagram: 'Instagram : @ksc_wiedikon',
  impressumDisclaimer: 'Clause de non-responsabilite',
  impressumDisclaimerText:
    'Le KSC Wiedikon n\'assume aucune responsabilite quant a l\'exactitude, l\'exhaustivite ou l\'actualite des informations fournies. Les pretentions en responsabilite contre le KSC Wiedikon relatives a des dommages materiels ou immateriels sont en principe exclues.',

  // Privacy notice bar
  noticeCookies: 'Ce site web n\'utilise pas de cookies de suivi.',
  noticeLink: 'En savoir plus',
} as const
