import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Glasses } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LANGUAGES } from '../i18n/languageConfig'
import { i18nToBackendLang } from '../utils/languageMap'
import { useAuth } from '../hooks/useAuth'
import { updateRecord } from '../lib/api'

import deFlag from '../assets/flags/de.svg'
import gbFlag from '../assets/flags/gb.svg'
import frFlag from '../assets/flags/fr.svg'
import itFlag from '../assets/flags/it.svg'
import chFlag from '../assets/flags/ch.svg'

const flagMap: Record<string, string> = {
  de: deFlag,
  gb: gbFlag,
  fr: frFlag,
  it: itFlag,
  ch: chFlag,
}

interface LanguageDropdownProps {
  size?: 'sm' | 'md'
}

export default function LanguageDropdown({ size = 'sm' }: LanguageDropdownProps) {
  const { i18n } = useTranslation()
  const { user } = useAuth()

  const currentLang = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0]
  const regularLanguages = LANGUAGES.filter((l) => !('isCasual' in l && l.isCasual))
  const casualLanguages = LANGUAGES.filter((l) => 'isCasual' in l && l.isCasual)

  const flagSize = size === 'sm' ? 'w-5 h-[15px]' : 'w-6 h-[18px]'
  const squareFlagSize = size === 'sm' ? 'w-[15px] h-[15px]' : 'w-[18px] h-[18px]'
  const textSize = size === 'sm' ? 'text-sm' : 'text-base'

  async function handleSelect(code: string) {
    i18n.changeLanguage(code)
    localStorage.setItem('wiedisync-lang', code)

    if (user) {
      try {
        await updateRecord('members', user.id, {
          language: i18nToBackendLang(code),
        })
      } catch {
        // Silently fail — localStorage is the primary store
      }
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
          aria-label="Select language"
        >
          <img
            src={flagMap[currentLang.flag]}
            alt=""
            className={`${currentLang.flag === 'ch' ? squareFlagSize : flagSize} rounded-[3px] object-cover`}
          />
          <span className={`${textSize} text-gray-700 dark:text-gray-200`}>
            {currentLang.nativeName}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {regularLanguages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => handleSelect(lang.code)}
            className="flex items-center gap-2.5 cursor-pointer"
          >
            <img
              src={flagMap[lang.flag]}
              alt=""
              className={`${lang.flag === 'ch' ? 'w-[15px] h-[15px]' : 'w-5 h-[15px]'} rounded-[2px] object-cover`}
            />
            <span className="flex-1">{lang.nativeName}</span>
            {i18n.language === lang.code && (
              <Check className="h-4 w-4 text-brand-600 dark:text-gold-400" />
            )}
          </DropdownMenuItem>
        ))}
        {casualLanguages.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {casualLanguages.map((lang) => (
              <DropdownMenuItem
                key={lang.code}
                onClick={() => handleSelect(lang.code)}
                className="flex items-center gap-2.5 cursor-pointer"
              >
                <img
                  src={flagMap[lang.flag]}
                  alt=""
                  className={`${lang.flag === 'ch' ? 'w-[15px] h-[15px]' : 'w-5 h-[15px]'} rounded-[2px] object-cover`}
                />
                <span className="flex-1">{lang.nativeName}</span>
                {i18n.language === lang.code ? (
                  <Check className="h-4 w-4 text-brand-600 dark:text-gold-400" />
                ) : (
                  <Glasses className="h-4 w-4 text-gray-400 dark:text-gray-500" aria-hidden="true" />
                )}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
