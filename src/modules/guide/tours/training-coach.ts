import { ClipboardList } from 'lucide-react'
import type { TourDefinition } from '../types'

export const trainingCoachTour: TourDefinition = {
  id: 'training-coach',
  titleKey: 'guide:tours.trainingCoach.title',
  descriptionKey: 'guide:tours.trainingCoach.description',
  icon: ClipboardList,
  section: 'coach',
  canAccess: (a) => a.isCoach,
  route: '/trainings',
  steps: [
    {
      target: '[data-tour="coach-dashboard"]',
      titleKey: 'guide:tours.trainingCoach.steps.overview.title',
      bodyKey: 'guide:tours.trainingCoach.steps.overview.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="new-training"]',
      titleKey: 'guide:tours.trainingCoach.steps.create.title',
      bodyKey: 'guide:tours.trainingCoach.steps.create.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="attendance-stats"]',
      titleKey: 'guide:tours.trainingCoach.steps.attendance.title',
      bodyKey: 'guide:tours.trainingCoach.steps.attendance.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="training-card"]',
      titleKey: 'guide:tours.trainingCoach.steps.cancel.title',
      bodyKey: 'guide:tours.trainingCoach.steps.cancel.body',
      placement: 'top',
    },
  ],
}
