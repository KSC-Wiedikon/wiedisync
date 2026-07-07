import { gettingStartedTour } from './getting-started'
import { profileTour } from './profile'
import { trainingPlayerTour } from './training-player'
import { trainingCoachTour } from './training-coach'
import { gamesPlayerTour } from './games-player'
import { gamesCoachTour } from './games-coach'
import { eventsTour } from './events'
import { absencesTour } from './absences'
import { scorerPlayerTour } from './scorer-player'
import { scorerAdminTour } from './scorer-admin'
import { hallenplanCoachTour } from './hallenplan-coach'
import { teamsTour } from './teams'
import { formsTour } from './forms'
import { financeDuesTour } from './finance-dues'
import { expensesTour } from './expenses'
import type { TourDefinition } from '../types'

export const tourRegistry: TourDefinition[] = [
  gettingStartedTour,
  profileTour,
  trainingPlayerTour,
  gamesPlayerTour,
  eventsTour,
  absencesTour,
  scorerPlayerTour,
  teamsTour,
  formsTour,
  financeDuesTour,
  expensesTour,
  trainingCoachTour,
  gamesCoachTour,
  scorerAdminTour,
  hallenplanCoachTour,
]
