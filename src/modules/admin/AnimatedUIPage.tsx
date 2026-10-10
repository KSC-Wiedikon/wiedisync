import { useMemo, useState, type ReactNode } from 'react'
import { BarChart3, CalendarDays, MessageSquare, Palette, PartyPopper, Search, Settings, Sparkles, Volleyball } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

// ── Magic UI imports ──────────────────────────────────────────────────────────
import { ShimmerButton } from '@/components/magicui/shimmer-button'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { AnimatedShinyText } from '@/components/magicui/animated-shiny-text'
import { BorderBeam } from '@/components/magicui/border-beam'
import { MagicCard } from '@/components/magicui/magic-card'
import { Marquee } from '@/components/magicui/marquee'
import { Particles } from '@/components/magicui/particles'
import { Meteors as MagicMeteors } from '@/components/magicui/meteors'
import { Ripple } from '@/components/magicui/ripple'
import { GridPattern } from '@/components/magicui/grid-pattern'
import { DotPattern } from '@/components/magicui/dot-pattern'
import { RetroGrid } from '@/components/magicui/retro-grid'
import { AnimatedList } from '@/components/magicui/animated-list'
import { Dock, DockIcon } from '@/components/magicui/dock'
import { OrbitingCircles } from '@/components/magicui/orbiting-circles'
import { BlurFade } from '@/components/magicui/blur-fade'
import { TypingAnimation } from '@/components/magicui/typing-animation'
import { HyperText } from '@/components/magicui/hyper-text'
import { SparklesText } from '@/components/magicui/sparkles-text'
import { WordRotate } from '@/components/magicui/word-rotate'
import { AuroraText } from '@/components/magicui/aurora-text'
import { ShineBorder } from '@/components/magicui/shine-border'
import { NeonGradientCard } from '@/components/magicui/neon-gradient-card'
import { AvatarCircles } from '@/components/magicui/avatar-circles'
import { ConfettiButton } from '@/components/magicui/confetti'
import { RainbowButton } from '@/components/magicui/rainbow-button'
import { PulsatingButton } from '@/components/magicui/pulsating-button'
import { RippleButton } from '@/components/magicui/ripple-button'
import { InteractiveHoverButton } from '@/components/magicui/interactive-hover-button'
import { ShinyButton } from '@/components/magicui/shiny-button'
import { AnimatedGradientText } from '@/components/magicui/animated-gradient-text'
import { AnimatedCircularProgressBar } from '@/components/magicui/animated-circular-progress-bar'
import { FlickeringGrid } from '@/components/magicui/flickering-grid'
import { ComicText } from '@/components/magicui/comic-text'
import { SpinningText } from '@/components/magicui/spinning-text'
import { BentoCard, BentoGrid } from '@/components/magicui/bento-grid'
import { TextAnimate } from '@/components/magicui/text-animate'
import { ScrollProgress } from '@/components/magicui/scroll-progress'

// ── Full catalogs (for the "Browse all" list) ─────────────────────────────────
const MAGIC_UI_ALL = [
  'android','animated-beam','animated-circular-progress-bar','animated-gradient-text',
  'animated-grid-pattern','animated-list','animated-shiny-text','animated-theme-toggler',
  'aurora-text','avatar-circles','backlight','bento-grid','blur-fade','border-beam',
  'client-tweet-card','code-comparison','comic-text','confetti','cool-mode','dia-text-reveal',
  'dock','dot-pattern','dotted-map','file-tree','flickering-grid','glare-hover','globe',
  'grid-pattern','hero-video-dialog','hexagon-pattern','highlighter','hyper-text',
  'icon-cloud','interactive-grid-pattern','interactive-hover-button','iphone','kinetic-text',
  'lens','light-rays','line-shadow-text','magic-card','marquee','meteors','morphing-text',
  'neon-gradient-card','noise-texture','number-ticker','orbiting-circles','particles',
  'pixel-image','pointer','progressive-blur','pulsating-button','rainbow-button',
  'retro-grid','ripple','ripple-button','safari','scroll-based-velocity','scroll-progress',
  'shimmer-button','shine-border','shiny-button','smooth-cursor','sparkles-text',
  'spinning-text','striped-pattern','terminal','text-3d-flip','text-animate','text-reveal',
  'tweet-card','typing-animation','video-text','warp-background','word-rotate'
]

// ── Demo container ────────────────────────────────────────────────────────────
function Demo({ title, importPath, children }: {
  title: string
  importPath: string
  children: ReactNode
}) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-hairline bg-card shadow-card">
      <div className="flex items-center justify-between border-b border-hairline bg-surface-sunken px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs font-medium truncate" title={title}>{title}</span>
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-purple-500/15 text-purple-700 dark:text-purple-300">Magic UI</span>
        </div>
        <code className="text-[10px] text-muted-foreground truncate max-w-[60%]" title={importPath}>{importPath}</code>
      </div>
      <div className="relative flex items-center justify-center min-h-[200px] p-4 bg-background overflow-hidden">
        {children}
      </div>
    </div>
  )
}

export default function AnimatedUIPage() {
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()

  const filteredMagic = useMemo(
    () => (q ? MAGIC_UI_ALL.filter((n) => n.includes(q)) : MAGIC_UI_ALL),
    [q]
  )

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 border-b bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:-mt-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Animated UI library</h1>
            <span className="text-sm text-muted-foreground">
              {MAGIC_UI_ALL.length} components
            </span>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search component name…"
              className="pl-8"
            />
          </div>
        </div>
      </div>

      <Tabs defaultValue="featured" className="space-y-4">
        <TabsList>
          <TabsTrigger value="featured">Featured demos</TabsTrigger>
          <TabsTrigger value="magicui">All Magic UI ({MAGIC_UI_ALL.length})</TabsTrigger>
        </TabsList>

        {/* ── Featured ─────────────────────────────────────────────── */}
        <TabsContent value="featured" className="space-y-8">

          <section>
            <h2 className="mb-3 text-lg font-semibold">Buttons</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Demo title="ShimmerButton" importPath="@/components/magicui/shimmer-button">
                <ShimmerButton>Shimmer Button</ShimmerButton>
              </Demo>
              <Demo title="RainbowButton" importPath="@/components/magicui/rainbow-button">
                <RainbowButton>Rainbow Button</RainbowButton>
              </Demo>
              <Demo title="PulsatingButton" importPath="@/components/magicui/pulsating-button">
                <PulsatingButton>Pulsating</PulsatingButton>
              </Demo>
              <Demo title="RippleButton" importPath="@/components/magicui/ripple-button">
                <RippleButton>Click me</RippleButton>
              </Demo>
              <Demo title="ShinyButton" importPath="@/components/magicui/shiny-button">
                <ShinyButton>Shiny Button</ShinyButton>
              </Demo>
              <Demo title="InteractiveHoverButton" importPath="@/components/magicui/interactive-hover-button">
                <InteractiveHoverButton>Hover me</InteractiveHoverButton>
              </Demo>
              <Demo title="ConfettiButton" importPath="@/components/magicui/confetti">
                <ConfettiButton><span className="inline-flex items-center gap-2"><PartyPopper className="h-4 w-4" aria-hidden="true" />Confetti</span></ConfettiButton>
              </Demo>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Text effects</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Demo title="AuroraText" importPath="@/components/magicui/aurora-text">
                <AuroraText className="text-3xl font-bold">Aurora Text</AuroraText>
              </Demo>
              <Demo title="SparklesText" importPath="@/components/magicui/sparkles-text">
                <SparklesText className="text-3xl font-bold">Sparkles</SparklesText>
              </Demo>
              <Demo title="AnimatedShinyText" importPath="@/components/magicui/animated-shiny-text">
                <AnimatedShinyText className="text-lg">✨ Shiny text passing by</AnimatedShinyText>
              </Demo>
              <Demo title="AnimatedGradientText" importPath="@/components/magicui/animated-gradient-text">
                <AnimatedGradientText className="text-2xl font-bold">Gradient text</AnimatedGradientText>
              </Demo>
              <Demo title="TypingAnimation" importPath="@/components/magicui/typing-animation">
                <TypingAnimation className="text-2xl">Typing one letter at a time…</TypingAnimation>
              </Demo>
              <Demo title="HyperText" importPath="@/components/magicui/hyper-text">
                <HyperText className="text-2xl">SCRAMBLE</HyperText>
              </Demo>
              <Demo title="WordRotate" importPath="@/components/magicui/word-rotate">
                <div className="text-2xl font-semibold">
                  We are <WordRotate words={['fast', 'simple', 'modern', 'open']} className="text-primary inline-block" />
                </div>
              </Demo>
              <Demo title="SpinningText" importPath="@/components/magicui/spinning-text">
                <SpinningText>spinning text • spinning text •</SpinningText>
              </Demo>
              <Demo title="ComicText" importPath="@/components/magicui/comic-text">
                <ComicText>POW!</ComicText>
              </Demo>
              <Demo title="TextAnimate" importPath="@/components/magicui/text-animate">
                <TextAnimate animation="blurInUp" by="word" className="text-xl">
                  Animate text in any direction
                </TextAnimate>
              </Demo>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Cards & containers</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Demo title="MagicCard" importPath="@/components/magicui/magic-card">
                <MagicCard className="cursor-pointer p-6 rounded-lg w-full">
                  <div className="text-lg font-semibold">Hover me</div>
                  <p className="text-sm text-muted-foreground mt-1">Spotlight follows your cursor.</p>
                </MagicCard>
              </Demo>
              <Demo title="NeonGradientCard" importPath="@/components/magicui/neon-gradient-card">
                <NeonGradientCard className="w-full">
                  <div className="p-4 text-center font-semibold">Neon gradient</div>
                </NeonGradientCard>
              </Demo>
              <Demo title="BorderBeam" importPath="@/components/magicui/border-beam">
                <div className="relative w-full rounded-lg border bg-card p-6 overflow-hidden">
                  <div className="text-lg font-semibold">Beam runs the border</div>
                  <BorderBeam size={150} duration={6} />
                </div>
              </Demo>
              <Demo title="ShineBorder" importPath="@/components/magicui/shine-border">
                <div className="relative w-full rounded-lg border bg-card p-6 overflow-hidden">
                  <div className="text-lg font-semibold">Shine sweeps the border</div>
                  <ShineBorder shineColor={['#4A55A2', '#FFC832', '#4A55A2']} />
                </div>
              </Demo>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Backgrounds</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Demo title="Particles" importPath="@/components/magicui/particles">
                <div className="relative w-full h-full">
                  <Particles className="absolute inset-0" quantity={60} />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Particles</div>
                </div>
              </Demo>
              <Demo title="Meteors" importPath="@/components/magicui/meteors">
                <div className="relative w-full h-full overflow-hidden">
                  <MagicMeteors number={20} />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Meteors</div>
                </div>
              </Demo>
              <Demo title="Ripple" importPath="@/components/magicui/ripple">
                <div className="relative w-full h-full">
                  <Ripple />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Ripple</div>
                </div>
              </Demo>
              <Demo title="GridPattern" importPath="@/components/magicui/grid-pattern">
                <div className="relative w-full h-full">
                  <GridPattern className="absolute inset-0 [mask-image:radial-gradient(white,transparent_85%)]" />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Grid Pattern</div>
                </div>
              </Demo>
              <Demo title="DotPattern" importPath="@/components/magicui/dot-pattern">
                <div className="relative w-full h-full">
                  <DotPattern className="absolute inset-0 [mask-image:radial-gradient(white,transparent_85%)]" />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Dot Pattern</div>
                </div>
              </Demo>
              <Demo title="RetroGrid" importPath="@/components/magicui/retro-grid">
                <div className="relative w-full h-full">
                  <RetroGrid />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Retro Grid</div>
                </div>
              </Demo>
              <Demo title="FlickeringGrid" importPath="@/components/magicui/flickering-grid">
                <div className="relative w-full h-full">
                  <FlickeringGrid className="absolute inset-0" squareSize={4} gridGap={6} color="#4A55A2" />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Flickering Grid</div>
                </div>
              </Demo>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Data & motion</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Demo title="NumberTicker" importPath="@/components/magicui/number-ticker">
                <NumberTicker value={1024} className="text-4xl font-bold" />
              </Demo>
              <Demo title="AnimatedCircularProgressBar" importPath="@/components/magicui/animated-circular-progress-bar">
                <AnimatedCircularProgressBar
                  max={100}
                  min={0}
                  value={72}
                  gaugePrimaryColor="#4A55A2"
                  gaugeSecondaryColor="#e5e7eb"
                />
              </Demo>
              <Demo title="OrbitingCircles" importPath="@/components/magicui/orbiting-circles">
                <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
                  <OrbitingCircles iconSize={20}>
                    <span className="text-xs">A</span>
                    <span className="text-xs">B</span>
                    <span className="text-xs">C</span>
                  </OrbitingCircles>
                </div>
              </Demo>
              <Demo title="Marquee" importPath="@/components/magicui/marquee">
                <div className="w-full">
                  <Marquee pauseOnHover className="[--duration:20s]">
                    {['React', 'TypeScript', 'Vite', 'Tailwind', 'shadcn', 'Directus'].map((x) => (
                      <span key={x} className="mx-3 rounded-md border bg-card px-3 py-1 text-sm">{x}</span>
                    ))}
                  </Marquee>
                </div>
              </Demo>
              <Demo title="AnimatedList" importPath="@/components/magicui/animated-list">
                <AnimatedList className="w-full" delay={1500}>
                  {[
                    { title: 'New message', desc: 'Hi there!' },
                    { title: 'Payment received', desc: '+CHF 50.00' },
                    { title: 'New follower', desc: '@maria' },
                  ].map((item) => (
                    <div key={item.title} className="rounded-lg border bg-card px-3 py-2">
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="text-xs text-muted-foreground">{item.desc}</div>
                    </div>
                  ))}
                </AnimatedList>
              </Demo>
              <Demo title="Dock" importPath="@/components/magicui/dock">
                <Dock>
                  {[
                    { key: 'settings', Icon: Settings },
                    { key: 'palette', Icon: Palette },
                    { key: 'calendar', Icon: CalendarDays },
                    { key: 'messages', Icon: MessageSquare },
                    { key: 'volleyball', Icon: Volleyball },
                  ].map(({ key, Icon }) => (
                    <DockIcon key={key}>
                      <Icon className="h-6 w-6" aria-hidden="true" />
                    </DockIcon>
                  ))}
                </Dock>
              </Demo>
              <Demo title="BlurFade" importPath="@/components/magicui/blur-fade">
                <BlurFade delay={0.1}>
                  <div className="text-2xl font-bold">Blur-fades in</div>
                </BlurFade>
              </Demo>
              <Demo title="AvatarCircles" importPath="@/components/magicui/avatar-circles">
                <AvatarCircles
                  numPeople={42}
                  avatarUrls={[
                    { imageUrl: 'https://avatars.githubusercontent.com/u/16860528', profileUrl: '#' },
                    { imageUrl: 'https://avatars.githubusercontent.com/u/20110627', profileUrl: '#' },
                    { imageUrl: 'https://avatars.githubusercontent.com/u/106103625', profileUrl: '#' },
                  ]}
                />
              </Demo>
              <Demo title="ScrollProgress" importPath="@/components/magicui/scroll-progress">
                <div className="relative w-full h-full">
                  <ScrollProgress className="!top-0 !sticky" />
                  <div className="mt-6 text-sm text-muted-foreground">Page scroll indicator (top of viewport)</div>
                </div>
              </Demo>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Bento</h2>
            <BentoGrid className="!grid-cols-2 lg:!grid-cols-3">
              <BentoCard
                name="Members"
                description="358 active across 9 teams"
                Icon={Volleyball}
                className="col-span-1 row-span-1"
                href="#"
                cta="View"
                background={<MagicMeteors number={10} />}
              />
              <BentoCard
                name="Trainings"
                description="12 this week"
                Icon={CalendarDays}
                className="col-span-1 row-span-1"
                href="#"
                cta="View"
                background={<div className="absolute inset-0"><DotPattern /></div>}
              />
              <BentoCard
                name="Hallenplan"
                description="Live slot conflicts"
                Icon={BarChart3}
                className="col-span-2 row-span-1"
                href="#"
                cta="Open"
                background={<div className="absolute inset-0 opacity-50"><Particles quantity={40} /></div>}
              />
            </BentoGrid>
          </section>

        </TabsContent>

        {/* ── Magic UI catalog ─────────────────────────────────────── */}
        <TabsContent value="magicui">
          <p className="mb-3 text-sm text-muted-foreground">
            All {MAGIC_UI_ALL.length} Magic UI components — import path + docs link.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filteredMagic.map((name) => (
              <a
                key={name}
                href={`https://magicui.design/docs/components/${name}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border bg-card px-3 py-2 hover:bg-accent transition-colors"
              >
                <div className="font-mono text-sm font-medium">{name}</div>
                <div className="text-[10px] text-muted-foreground truncate" title={`@/components/magicui/${name}`}>@/components/magicui/{name}</div>
              </a>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
