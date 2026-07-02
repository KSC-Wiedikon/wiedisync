import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LANGUAGES, type BackendLanguage } from '../i18n/languageConfig'
import deFlag from '../assets/flags/de.svg'
import gbFlag from '../assets/flags/gb.svg'
import frFlag from '../assets/flags/fr.svg'
import itFlag from '../assets/flags/it.svg'
import chFlag from '../assets/flags/ch.svg'

const flagMap: Record<string, string> = { de: deFlag, gb: gbFlag, fr: frFlag, it: itFlag, ch: chFlag }

interface LanguageSelectProps {
  value: BackendLanguage
  onChange: (value: BackendLanguage) => void
}

export default function LanguageSelect({ value, onChange }: LanguageSelectProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as BackendLanguage)}>
      <SelectTrigger className="min-h-[44px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LANGUAGES.map((lang) => (
          <SelectItem key={lang.backendValue} value={lang.backendValue}>
            <span className="flex items-center gap-2">
              <img src={flagMap[lang.flag]} alt="" className={`${lang.flag === 'ch' ? 'w-[15px] h-[15px]' : 'w-5 h-[15px]'} rounded-[2px]`} />
              {lang.nativeName}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
