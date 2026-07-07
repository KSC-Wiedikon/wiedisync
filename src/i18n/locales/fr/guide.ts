export default {
  menu: {
    title: 'Guide',
    subtitle: 'Découvrir WiediSync',
    resetAll: 'Tout réinitialiser',
    completed: 'Terminé',
    steps: '{{count}} étapes',
    restart: 'Revoir la visite ?',
  },
  welcome: {
    title: 'Bienvenue sur WiediSync !',
    body: 'Souhaitez-vous une brève introduction aux principales fonctionnalités ?',
    start: 'Oui, allons-y',
    skip: 'Passer',
  },
  offer: {
    coachTools: 'Vous avez des outils coach ici. Visite rapide ?',
    adminTools: 'Voici vos outils admin. Visite rapide ?',
    start: 'Montrez-moi',
    skip: 'Pas maintenant',
  },
  tooltip: {
    skip: 'Passer',
    back: 'Retour',
    next: 'Suivant',
    finish: 'Terminé',
    stepOf: 'sur',
  },
  sections: {
    basics: 'Bases',
    member: 'Fonctions membre',
    coach: 'Fonctions coach',
    admin: 'Fonctions admin',
  },
  tours: {
    gettingStarted: {
      title: 'Premiers pas',
      description: 'Apprenez les bases de WiediSync',
      steps: {
        nav: {
          title: 'Navigation',
          body: 'Toutes les sections de l\'application se trouvent ici. Sur mobile, la navigation est en bas.',
        },
        home: {
          title: 'Accueil',
          body: 'Votre tableau de bord personnel : prochains matchs, entraînements, sondages ouverts et formulaires à remplir en un coup d\'œil.',
        },
        profile: {
          title: 'Mon profil',
          body: 'Consultez et modifiez vos informations personnelles, coordonnées et paramètres de notification.',
        },
        language: {
          title: 'Langue',
          body: 'La langue de l\'application peut être changée à tout moment dans le menu des paramètres.',
        },
        notifications: {
          title: 'Notifications',
          body: 'Restez informé — gérez les notifications push et les alertes in-app ici.',
        },
      },
    },
    trainingPlayer: {
      title: 'Entraînements — Joueur',
      description: 'Comment gérer votre présence aux entraînements',
      steps: {
        list: {
          title: 'Liste des entraînements',
          body: 'Tous les prochains entraînements de votre équipe avec date, heure et lieu.',
        },
        rsvpButtons: {
          title: 'RSVP',
          body: 'Appuyez sur Oui, Peut-être ou Non. Selon les réglages de votre équipe, vous êtes peut-être déjà confirmé automatiquement — dans ce cas, appuyez simplement sur Non quand vous ne pouvez pas venir. Votre coach voit les statistiques de présence.',
        },
        absence: {
          title: 'Note d\'absence',
          body: 'Si vous ne pouvez pas participer, vous pouvez ajouter une courte explication.',
        },
        stats: {
          title: 'Statistiques de présence',
          body: 'Suivez votre propre taux de présence sur toute la saison.',
        },
      },
    },
    trainingCoach: {
      title: 'Entraînements — Coach',
      description: 'Comment gérer les entraînements en tant que coach',
      steps: {
        overview: {
          title: 'Vue d\'ensemble de l\'équipe',
          body: 'Voyez d\'un coup d\'œil qui est présent, qui est absent et qui n\'a pas encore répondu.',
        },
        create: {
          title: 'Créer un entraînement',
          body: 'Ajoutez une nouvelle séance avec date, heure, lieu et notes facultatives.',
        },
        attendance: {
          title: 'Liste de présence',
          body: 'Consultez la liste complète de présence pour chaque entraînement et exportez-la si nécessaire.',
        },
        cancel: {
          title: 'Annuler un entraînement',
          body: 'Utilisez l\'icône d\'annulation sur une carte d\'entraînement pour l\'annuler avec un motif facultatif — les joueurs sont notifiés et les RSVP sont gelés. Le même endroit permet de rétablir une séance annulée.',
        },
      },
    },
    gamesPlayer: {
      title: 'Matchs — Joueur',
      description: 'Comment suivre vos matchs et résultats',
      steps: {
        list: {
          title: 'Liste des matchs',
          body: 'Tous vos matchs à venir et passés avec date, adversaire et résultat.',
        },
        rsvp: {
          title: 'RSVP match',
          body: 'Confirmez si vous serez présent au match. Avec la confirmation automatique, vous êtes marqué présent d\'office — n\'agissez que si vous ne pouvez pas venir. Votre coach voit ces réponses.',
        },
        result: {
          title: 'Résultats',
          body: 'Les résultats et scores de sets sont mis à jour automatiquement depuis le système de ligue. Utilisez le sélecteur de saison dans les classements pour consulter les saisons passées.',
        },
        details: {
          title: 'Détails du match',
          body: 'Appuyez sur un match pour voir tous les détails : lieu, heure de rendez-vous, composition et marqueur.',
        },
      },
    },
    gamesCoach: {
      title: 'Matchs — Coach',
      description: 'Outils coach sur la page des matchs',
      steps: {
        dashboard: {
          title: 'Tableau de bord des présences',
          body: 'Ouvrez l\'onglet Tableau de bord pour les statistiques de présence de votre équipe sur une période donnée.',
        },
        stats: {
          title: 'Statistiques par joueur',
          body: 'Matchs joués, présences, absences et taux de présence par joueur — appuyez sur une ligne pour le détail match par match.',
        },
        manage: {
          title: 'Gérer un match',
          body: 'Ouvrez un match pour voir les détails et les actions coach — annuler ou rétablir un match notifie votre équipe. La planification des matchs se fait dans l\'application Spielplanung.',
        },
      },
    },
    events: {
      title: 'Événements',
      description: 'Événements du club et activités d\'équipe',
      steps: {
        list: {
          title: 'Liste des événements',
          body: 'Les événements du club et les activités d\'équipe sont affichés ici.',
        },
        rsvp: {
          title: 'Inscription à l\'événement',
          body: 'Inscrivez-vous aux événements, tournois et activités sociales.',
        },
        details: {
          title: 'Détails de l\'événement',
          body: 'Lieu, heure, description et liste des participants inscrits.',
        },
      },
    },
    absences: {
      title: 'Absences',
      description: 'Gérez vos absences planifiées',
      steps: {
        list: {
          title: 'Liste des absences',
          body: 'Toutes vos absences planifiées en un seul endroit — visibles par vos coaches.',
        },
        create: {
          title: 'Ajouter une absence',
          body: 'Appuyez sur le bouton plus pour ajouter une période d\'absence avec dates de début, fin et motif.',
        },
        coachView: {
          title: 'Vue coach',
          body: 'Les coaches voient toutes les absences de l\'équipe superposées au calendrier pour anticiper.',
        },
      },
    },
    scorerPlayer: {
      title: 'Marqueur — Joueur',
      description: 'Vos attributions comme marqueur',
      steps: {
        duty: {
          title: 'Service de marqueur',
          body: 'Si vous êtes désigné marqueur pour un match, vous le verrez ici et recevrez une notification.',
        },
        filters: {
          title: 'Filtres',
          body: 'Filtrez vos services par date, équipe ou type de service, ou recherchez un match précis.',
        },
        delegate: {
          title: 'Déléguer',
          body: 'Vous ne pouvez pas venir ? Appuyez sur Déléguer à côté de votre nom pour proposer un coéquipier — il reçoit une demande qu\'il peut accepter ou refuser.',
        },
      },
    },
    scorerAdmin: {
      title: 'Marqueur — Admin',
      description: 'Attribuer les services de marqueur automatiquement',
      steps: {
        overview: {
          title: 'Vue d\'ensemble de la saison',
          body: 'Tous les matchs à domicile de la saison en cours qui nécessitent une équipe de service marqueur ou Täfeler sont chargés ici.',
        },
        run: {
          title: 'Attribution automatique',
          body: 'Lancez l\'algorithme d\'attribution pour répartir les services équitablement entre les équipes. Ouvrez le panneau des règles de l\'algorithme pour voir comment il décide.',
        },
        summary: {
          title: 'Résumé par équipe',
          body: 'Combien de services chaque équipe a reçus lors de cette exécution — vérifiez l\'équilibre avant d\'enregistrer.',
        },
        assign: {
          title: 'Vérifier et ajuster',
          body: 'Changez l\'équipe de service de n\'importe quel match via son menu déroulant, puis enregistrez toutes les attributions.',
        },
      },
    },
    hallenplanCoach: {
      title: 'Planning salle — Coach',
      description: 'Gérer les créneaux de salle',
      steps: {
        overview: {
          title: 'Planning de salle',
          body: 'Tous les créneaux de salle de vos équipes sont affichés ici — entraînements, matchs et créneaux libres.',
        },
        claim: {
          title: 'Réserver un créneau libéré',
          body: 'Quand une équipe libère un créneau, une pastille apparaît ici — appuyez dessus pour voir et réserver les créneaux disponibles pour votre équipe.',
        },
        release: {
          title: 'Couleurs des créneaux',
          body: 'Les couleurs indiquent le type de créneau : entraînements, matchs, créneaux libérés et fermetures. Appuyez sur un créneau de votre équipe pour le gérer ou le libérer.',
        },
        virtual: {
          title: 'Entrées automatiques',
          body: 'Les matchs, entraînements et événements du calendrier apparaissent automatiquement comme entrées avec un badge « Auto » — ils sont projetés en direct, pas réservés.',
        },
      },
    },
    profile: {
      title: 'Profil et paramètres',
      description: 'Ajustez votre compte',
      steps: {
        contact: {
          title: 'Vos coordonnées',
          body: 'Gardez vos coordonnées à jour — vos coaches en dépendent. Modifiez-les via le bouton Modifier le profil.',
        },
        attendance: {
          title: 'Inscription automatique',
          body: 'Choisissez si vous êtes automatiquement confirmé pour les nouveaux entraînements, matchs et événements. Les absences priment toujours sur la confirmation automatique.',
        },
        emails: {
          title: 'Notifications par e-mail',
          body: 'Désactivez des alertes e-mail individuelles — la cloche de notification in-app affiche toujours tout.',
        },
        privacy: {
          title: 'Confidentialité',
          body: 'Un badge « Masqué » signifie que vos coéquipiers ne voient pas votre e-mail. Modifiez cela et plus encore sous Modifier le profil.',
        },
      },
    },
    teams: {
      title: 'Équipes',
      description: 'Vos équipes — et comment en rejoindre d\'autres',
      steps: {
        list: {
          title: 'Vos équipes',
          body: 'Toutes vos équipes en un coup d\'œil. Appuyez sur une équipe pour voir l\'effectif, le staff et les matchs.',
        },
        join: {
          title: 'Rejoindre une autre équipe',
          body: 'Demandez à rejoindre une autre équipe — choisissez le sport et l\'équipe, et un coach approuve votre demande. Quitter une équipe se fait au même endroit.',
        },
      },
    },
    forms: {
      title: 'Formulaires',
      description: 'Remplissez les formulaires du club et de l\'équipe',
      steps: {
        list: {
          title: 'Formulaires ouverts',
          body: 'Les formulaires que votre club ou votre équipe vous demande de remplir sont listés ici — les formulaires ouverts apparaissent aussi sur votre page d\'accueil.',
        },
        fill: {
          title: 'Remplir un formulaire',
          body: 'Appuyez sur Remplir pour répondre. Vous pouvez modifier votre réponse tant que le formulaire reste ouvert.',
        },
        create: {
          title: 'Créer des formulaires',
          body: 'Les coaches, responsables d\'équipe et le comité peuvent créer des formulaires, voir les réponses et les exporter.',
        },
      },
    },
    financeDues: {
      title: 'Mes finances',
      description: 'Payez cotisations et factures dans l\'application',
      steps: {
        iban: {
          title: 'IBAN de remboursement',
          body: 'Les remboursements du club sont versés sur ce compte — ajoutez ou mettez à jour votre IBAN ici.',
        },
        list: {
          title: 'Vos factures',
          body: 'Cotisations de membre et factures du club avec leurs montants et leur statut de paiement.',
        },
        pay: {
          title: 'Payer une facture',
          body: 'Appuyez sur une facture ouverte pour la déplier, puis scannez la QR-facture suisse avec TWINT ou votre application bancaire et appuyez sur « J\'ai payé ».',
        },
        status: {
          title: 'Statut de paiement',
          body: 'Après avoir signalé un paiement, la facture affiche « En attente de confirmation » jusqu\'à ce que le trésorier la confirme.',
        },
      },
    },
    expenses: {
      title: 'Frais',
      description: 'Faites-vous rembourser les frais du club',
      steps: {
        upload: {
          title: 'Importer un justificatif',
          body: 'Choisissez une photo ou un PDF de votre justificatif — le montant, la date et le fournisseur sont lus automatiquement.',
        },
        iban: {
          title: 'Vérifier l\'IBAN',
          body: 'Avant d\'envoyer, vérifiez l\'IBAN de versement — c\'est votre propre compte sur lequel le club vous rembourse.',
        },
        submissions: {
          title: 'Mes demandes',
          body: 'Suivez vos demandes ici : en attente, payées ou refusées. Vous êtes notifié dès que le trésorier décide.',
        },
      },
    },
  },
} as const
