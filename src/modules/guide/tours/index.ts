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
import { calendarTour } from './calendar'
import { inboxTour } from './inbox'
import { newsTour } from './news'
import { finesTour } from './fines'
import type { TourDefinition } from '../types'

export const tourRegistry: TourDefinition[] = [
  gettingStartedTour,
  profileTour,
  trainingPlayerTour,
  gamesPlayerTour,
  eventsTour,
  calendarTour,
  absencesTour,
  scorerPlayerTour,
  teamsTour,
  formsTour,
  inboxTour,
  newsTour,
  financeDuesTour,
  expensesTour,
  finesTour,
  trainingCoachTour,
  gamesCoachTour,
  scorerAdminTour,
  hallenplanCoachTour,
]
