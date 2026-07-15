import { Newspaper } from 'lucide-react'
import type { TourDefinition } from '../types'

export const newsTour: TourDefinition = {
  id: 'news',
  titleKey: 'guide:tours.news.title',
  descriptionKey: 'guide:tours.news.description',
  icon: Newspaper,
  section: 'member',
  canAccess: () => true,
  route: '/news',
  steps: [
    {
      target: '[data-tour="news-feed"]',
      titleKey: 'guide:tours.news.steps.feed.title',
      bodyKey: 'guide:tours.news.steps.feed.body',
      placement: 'top',
    },
    {
      target: '[data-tour="news-loadmore"]',
      titleKey: 'guide:tours.news.steps.loadMore.title',
      bodyKey: 'guide:tours.news.steps.loadMore.body',
      placement: 'top',
    },
  ],
}
