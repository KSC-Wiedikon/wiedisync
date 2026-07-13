// @ts-nocheck
import { useMemo, useState, type ReactNode } from 'react'
import { Sparkles, Search } from 'lucide-react'
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

// ── Aceternity imports ────────────────────────────────────────────────────────
import { Spotlight } from '@/components/aceternity/spotlight'
import { SparklesCore } from '@/components/aceternity/sparkles'
import { BackgroundBeams } from '@/components/aceternity/background-beams'
import { BackgroundGradient } from '@/components/aceternity/background-gradient'
import { AuroraBackground } from '@/components/aceternity/aurora-background'
import { Button as MovingBorderButton } from '@/components/aceternity/moving-border'
import { TextGenerateEffect } from '@/components/aceternity/text-generate-effect'
import { HoverBorderGradient } from '@/components/aceternity/hover-border-gradient'
import { CardContainer, CardBody, CardItem } from '@/components/aceternity/3d-card'
import { HoverEffect } from '@/components/aceternity/card-hover-effect'
import { FlipWords } from '@/components/aceternity/flip-words'
import { TypewriterEffect } from '@/components/aceternity/typewriter-effect'
import { FollowerPointerCard } from '@/components/aceternity/following-pointer'
import { Boxes } from '@/components/aceternity/background-boxes'
import { WavyBackground } from '@/components/aceternity/wavy-background'
import { ShootingStars } from '@/components/aceternity/shooting-stars'
import { BackgroundLines } from '@/components/aceternity/background-lines'
import { Compare } from '@/components/aceternity/compare'
import { CometCard } from '@/components/aceternity/comet-card'
import { GlareCard } from '@/components/aceternity/glare-card'
import { LampContainer } from '@/components/aceternity/lamp'
import { PointerHighlight } from '@/components/aceternity/pointer-highlight'

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

const ACETERNITY_ALL = [
  '3d-card','3d-globe','3d-marquee','3d-pin','animated-modal','animated-testimonials',
  'animated-tooltip','apple-cards-carousel','ascii-art','aurora-background','background-beams',
  'background-beams-with-collision','background-boxes','background-gradient','background-lines',
  'bento-grid','canvas-reveal-effect','canvas-text','card-hover-effect','card-spotlight',
  'card-stack','carousel','colourful-text','comet-card','compare','container-scroll-animation',
  'container-text-flip','cover','direction-aware-hover','dotted-glow-background','draggable-card',
  'encrypted-text','evervault-card','file-upload','flip-words','floating-dock','floating-navbar',
  'focus-cards','following-pointer','glare-card','globe','glowing-effect','glowing-stars',
  'google-gemini-effect','gradient-input','grid','hero-highlight','hero-parallax',
  'hero-scroll-animation','hover-border-gradient','infinite-moving-cards','input','label',
  'lamp','layout-grid','lens','link-preview','logo-cloud','macbook-scroll','meteors',
  'mini-navbar','moving-border','moving-line','navbar-menu','parallax-scroll','pin-container',
  'placeholders-and-vanish-input','pointer-highlight','resizable-navbar','reveal','sequence',
  'shooting-stars','sidebar','signup-form','sparkles','spotlight','sticky-banner',
  'sticky-scroll-reveal','svg-mask-effect','sweetviewer','tabs','tailwindcss-buttons',
  'text-generate-effect','text-hover-effect','text-reveal-card','text-scroll','timeline',
  'tracing-beam','typewriter-effect','vortex','wavy-background','wobble-card','world-map'
]

// ── Demo container ────────────────────────────────────────────────────────────
function Demo({ title, lib, importPath, children }: {
  title: string
  lib: 'magicui' | 'aceternity'
  importPath: string
  children: ReactNode
}) {
  return (
    <div className="group relative flex flex-col rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs font-medium truncate">{title}</span>
          <span className={
            'rounded px-1.5 py-0.5 text-[10px] font-medium ' +
            (lib === 'magicui' ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300')
          }>{lib === 'magicui' ? 'Magic UI' : 'Aceternity'}</span>
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
  const filteredAce = useMemo(
    () => (q ? ACETERNITY_ALL.filter((n) => n.includes(q)) : ACETERNITY_ALL),
    [q]
  )

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 border-b bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:-mt-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Animated UI library</h1>
            <span className="text-sm text-muted-foreground">
              {MAGIC_UI_ALL.length + ACETERNITY_ALL.length} components
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
          <TabsTrigger value="aceternity">All Aceternity ({ACETERNITY_ALL.length})</TabsTrigger>
        </TabsList>

        {/* ── Featured ─────────────────────────────────────────────── */}
        <TabsContent value="featured" className="space-y-8">

          <section>
            <h2 className="mb-3 text-lg font-semibold">Buttons</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Demo title="ShimmerButton" lib="magicui" importPath="@/components/magicui/shimmer-button">
                <ShimmerButton>Shimmer Button</ShimmerButton>
              </Demo>
              <Demo title="RainbowButton" lib="magicui" importPath="@/components/magicui/rainbow-button">
                <RainbowButton>Rainbow Button</RainbowButton>
              </Demo>
              <Demo title="PulsatingButton" lib="magicui" importPath="@/components/magicui/pulsating-button">
                <PulsatingButton>Pulsating</PulsatingButton>
              </Demo>
              <Demo title="RippleButton" lib="magicui" importPath="@/components/magicui/ripple-button">
                <RippleButton>Click me</RippleButton>
              </Demo>
              <Demo title="ShinyButton" lib="magicui" importPath="@/components/magicui/shiny-button">
                <ShinyButton>Shiny Button</ShinyButton>
              </Demo>
              <Demo title="InteractiveHoverButton" lib="magicui" importPath="@/components/magicui/interactive-hover-button">
                <InteractiveHoverButton>Hover me</InteractiveHoverButton>
              </Demo>
              <Demo title="ConfettiButton" lib="magicui" importPath="@/components/magicui/confetti">
                <ConfettiButton>🎉 Confetti</ConfettiButton>
              </Demo>
              <Demo title="MovingBorder Button" lib="aceternity" importPath="@/components/aceternity/moving-border">
                <MovingBorderButton borderRadius="1.75rem" className="bg-background text-foreground border-border">
                  Moving border
                </MovingBorderButton>
              </Demo>
              <Demo title="HoverBorderGradient" lib="aceternity" importPath="@/components/aceternity/hover-border-gradient">
                <HoverBorderGradient containerClassName="rounded-full" className="bg-background text-foreground flex items-center gap-2">
                  Gradient border
                </HoverBorderGradient>
              </Demo>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Text effects</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Demo title="AuroraText" lib="magicui" importPath="@/components/magicui/aurora-text">
                <AuroraText className="text-3xl font-bold">Aurora Text</AuroraText>
              </Demo>
              <Demo title="SparklesText" lib="magicui" importPath="@/components/magicui/sparkles-text">
                <SparklesText className="text-3xl font-bold">Sparkles</SparklesText>
              </Demo>
              <Demo title="AnimatedShinyText" lib="magicui" importPath="@/components/magicui/animated-shiny-text">
                <AnimatedShinyText className="text-lg">✨ Shiny text passing by</AnimatedShinyText>
              </Demo>
              <Demo title="AnimatedGradientText" lib="magicui" importPath="@/components/magicui/animated-gradient-text">
                <AnimatedGradientText className="text-2xl font-bold">Gradient text</AnimatedGradientText>
              </Demo>
              <Demo title="TypingAnimation" lib="magicui" importPath="@/components/magicui/typing-animation">
                <TypingAnimation className="text-2xl">Typing one letter at a time…</TypingAnimation>
              </Demo>
              <Demo title="HyperText" lib="magicui" importPath="@/components/magicui/hyper-text">
                <HyperText className="text-2xl">SCRAMBLE</HyperText>
              </Demo>
              <Demo title="WordRotate" lib="magicui" importPath="@/components/magicui/word-rotate">
                <div className="text-2xl font-semibold">
                  We are <WordRotate words={['fast', 'simple', 'modern', 'open']} className="text-primary inline-block" />
                </div>
              </Demo>
              <Demo title="SpinningText" lib="magicui" importPath="@/components/magicui/spinning-text">
                <SpinningText>spinning text • spinning text •</SpinningText>
              </Demo>
              <Demo title="ComicText" lib="magicui" importPath="@/components/magicui/comic-text">
                <ComicText>POW!</ComicText>
              </Demo>
              <Demo title="TextAnimate" lib="magicui" importPath="@/components/magicui/text-animate">
                <TextAnimate animation="blurInUp" by="word" className="text-xl">
                  Animate text in any direction
                </TextAnimate>
              </Demo>
              <Demo title="TextGenerateEffect" lib="aceternity" importPath="@/components/aceternity/text-generate-effect">
                <TextGenerateEffect words="Aceternity text generation effect for hero pages." />
              </Demo>
              <Demo title="FlipWords" lib="aceternity" importPath="@/components/aceternity/flip-words">
                <div className="text-2xl">
                  Build <FlipWords words={['better', 'faster', 'animated']} /> UIs
                </div>
              </Demo>
              <Demo title="TypewriterEffect" lib="aceternity" importPath="@/components/aceternity/typewriter-effect">
                <TypewriterEffect words={[
                  { text: 'Build' },
                  { text: 'awesome', className: 'text-primary' },
                  { text: 'apps.' },
                ]} />
              </Demo>
              <Demo title="PointerHighlight" lib="aceternity" importPath="@/components/aceternity/pointer-highlight">
                <div className="text-2xl">
                  Hover over <PointerHighlight>this phrase</PointerHighlight> to see it
                </div>
              </Demo>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Cards & containers</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Demo title="MagicCard" lib="magicui" importPath="@/components/magicui/magic-card">
                <MagicCard className="cursor-pointer p-6 rounded-lg w-full">
                  <div className="text-lg font-semibold">Hover me</div>
                  <p className="text-sm text-muted-foreground mt-1">Spotlight follows your cursor.</p>
                </MagicCard>
              </Demo>
              <Demo title="NeonGradientCard" lib="magicui" importPath="@/components/magicui/neon-gradient-card">
                <NeonGradientCard className="w-full">
                  <div className="p-4 text-center font-semibold">Neon gradient</div>
                </NeonGradientCard>
              </Demo>
              <Demo title="BorderBeam" lib="magicui" importPath="@/components/magicui/border-beam">
                <div className="relative w-full rounded-lg border bg-card p-6 overflow-hidden">
                  <div className="text-lg font-semibold">Beam runs the border</div>
                  <BorderBeam size={150} duration={6} />
                </div>
              </Demo>
              <Demo title="ShineBorder" lib="magicui" importPath="@/components/magicui/shine-border">
                <div className="relative w-full rounded-lg border bg-card p-6 overflow-hidden">
                  <div className="text-lg font-semibold">Shine sweeps the border</div>
                  <ShineBorder shineColor={['#4A55A2', '#FFC832', '#4A55A2']} />
                </div>
              </Demo>
              <Demo title="3D Card" lib="aceternity" importPath="@/components/aceternity/3d-card">
                <CardContainer className="inter-var">
                  <CardBody className="bg-card relative group/card border-border w-72 h-44 rounded-xl p-4 border">
                    <CardItem translateZ="50" className="text-lg font-bold">Tilt me</CardItem>
                    <CardItem translateZ="60" className="text-sm text-muted-foreground mt-2">
                      3D mouse-follow tilt
                    </CardItem>
                  </CardBody>
                </CardContainer>
              </Demo>
              <Demo title="CometCard" lib="aceternity" importPath="@/components/aceternity/comet-card">
                <CometCard>
                  <div className="w-64 h-40 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 p-4 text-white">
                    <div className="font-bold">Comet card</div>
                    <div className="text-sm opacity-80">3D tilt + spotlight</div>
                  </div>
                </CometCard>
              </Demo>
              <Demo title="GlareCard" lib="aceternity" importPath="@/components/aceternity/glare-card">
                <GlareCard className="flex flex-col items-center justify-center w-56 h-40">
                  <div className="text-white font-bold">Glare</div>
                </GlareCard>
              </Demo>
              <Demo title="BackgroundGradient" lib="aceternity" importPath="@/components/aceternity/background-gradient">
                <BackgroundGradient className="rounded-[22px] max-w-sm p-4 bg-card">
                  <div className="text-base font-semibold">Animated gradient ring</div>
                  <p className="text-sm text-muted-foreground">Wraps any card content.</p>
                </BackgroundGradient>
              </Demo>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Backgrounds</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Demo title="Particles" lib="magicui" importPath="@/components/magicui/particles">
                <div className="relative w-full h-full">
                  <Particles className="absolute inset-0" quantity={60} />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Particles</div>
                </div>
              </Demo>
              <Demo title="Meteors" lib="magicui" importPath="@/components/magicui/meteors">
                <div className="relative w-full h-full overflow-hidden">
                  <MagicMeteors number={20} />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Meteors</div>
                </div>
              </Demo>
              <Demo title="Ripple" lib="magicui" importPath="@/components/magicui/ripple">
                <div className="relative w-full h-full">
                  <Ripple />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Ripple</div>
                </div>
              </Demo>
              <Demo title="GridPattern" lib="magicui" importPath="@/components/magicui/grid-pattern">
                <div className="relative w-full h-full">
                  <GridPattern className="absolute inset-0 [mask-image:radial-gradient(white,transparent_85%)]" />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Grid Pattern</div>
                </div>
              </Demo>
              <Demo title="DotPattern" lib="magicui" importPath="@/components/magicui/dot-pattern">
                <div className="relative w-full h-full">
                  <DotPattern className="absolute inset-0 [mask-image:radial-gradient(white,transparent_85%)]" />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Dot Pattern</div>
                </div>
              </Demo>
              <Demo title="RetroGrid" lib="magicui" importPath="@/components/magicui/retro-grid">
                <div className="relative w-full h-full">
                  <RetroGrid />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Retro Grid</div>
                </div>
              </Demo>
              <Demo title="FlickeringGrid" lib="magicui" importPath="@/components/magicui/flickering-grid">
                <div className="relative w-full h-full">
                  <FlickeringGrid className="absolute inset-0" squareSize={4} gridGap={6} color="#4A55A2" />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Flickering Grid</div>
                </div>
              </Demo>
              <Demo title="Aurora Background" lib="aceternity" importPath="@/components/aceternity/aurora-background">
                <AuroraBackground className="!min-h-0 h-full w-full">
                  <div className="font-bold relative z-10">Aurora</div>
                </AuroraBackground>
              </Demo>
              <Demo title="Background Beams" lib="aceternity" importPath="@/components/aceternity/background-beams">
                <div className="relative w-full h-full">
                  <BackgroundBeams />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Beams</div>
                </div>
              </Demo>
              <Demo title="Wavy Background" lib="aceternity" importPath="@/components/aceternity/wavy-background">
                <WavyBackground containerClassName="h-full w-full !min-h-0" className="!h-full">
                  <div className="font-bold">Wavy</div>
                </WavyBackground>
              </Demo>
              <Demo title="Background Boxes" lib="aceternity" importPath="@/components/aceternity/background-boxes">
                <div className="relative w-full h-full overflow-hidden">
                  <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,white,transparent_70%)]">
                    <Boxes />
                  </div>
                  <div className="relative z-10 flex h-full items-center justify-center font-bold">Boxes</div>
                </div>
              </Demo>
              <Demo title="Shooting Stars" lib="aceternity" importPath="@/components/aceternity/shooting-stars">
                <div className="relative w-full h-full bg-black">
                  <ShootingStars />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold text-white">Stars</div>
                </div>
              </Demo>
              <Demo title="Background Lines" lib="aceternity" importPath="@/components/aceternity/background-lines">
                <BackgroundLines className="h-full w-full">
                  <div className="font-bold">Lines</div>
                </BackgroundLines>
              </Demo>
              <Demo title="Spotlight" lib="aceternity" importPath="@/components/aceternity/spotlight">
                <div className="relative w-full h-full bg-black/95 overflow-hidden">
                  <Spotlight className="-top-20 left-0" fill="white" />
                  <div className="relative z-10 flex h-full items-center justify-center font-bold text-white">Spotlight</div>
                </div>
              </Demo>
              <Demo title="Sparkles" lib="aceternity" importPath="@/components/aceternity/sparkles">
                <div className="relative w-full h-full bg-black">
                  <SparklesCore background="transparent" minSize={0.4} maxSize={1} particleDensity={120} className="w-full h-full" particleColor="#FFFFFF" />
                  <div className="absolute inset-0 z-10 flex items-center justify-center font-bold text-white">Sparkles</div>
                </div>
              </Demo>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Data & motion</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Demo title="NumberTicker" lib="magicui" importPath="@/components/magicui/number-ticker">
                <NumberTicker value={1024} className="text-4xl font-bold" />
              </Demo>
              <Demo title="AnimatedCircularProgressBar" lib="magicui" importPath="@/components/magicui/animated-circular-progress-bar">
                <AnimatedCircularProgressBar
                  max={100}
                  min={0}
                  value={72}
                  gaugePrimaryColor="#4A55A2"
                  gaugeSecondaryColor="#e5e7eb"
                />
              </Demo>
              <Demo title="OrbitingCircles" lib="magicui" importPath="@/components/magicui/orbiting-circles">
                <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
                  <OrbitingCircles iconSize={20}>
                    <span className="text-xs">A</span>
                    <span className="text-xs">B</span>
                    <span className="text-xs">C</span>
                  </OrbitingCircles>
                </div>
              </Demo>
              <Demo title="Marquee" lib="magicui" importPath="@/components/magicui/marquee">
                <div className="w-full">
                  <Marquee pauseOnHover className="[--duration:20s]">
                    {['React', 'TypeScript', 'Vite', 'Tailwind', 'shadcn', 'Directus'].map((x) => (
                      <span key={x} className="mx-3 rounded-md border bg-card px-3 py-1 text-sm">{x}</span>
                    ))}
                  </Marquee>
                </div>
              </Demo>
              <Demo title="AnimatedList" lib="magicui" importPath="@/components/magicui/animated-list">
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
              <Demo title="Dock" lib="magicui" importPath="@/components/magicui/dock">
                <Dock>
                  {['⚙️', '🎨', '📅', '💬', '🏐'].map((emoji) => (
                    <DockIcon key={emoji}>
                      <span className="text-2xl">{emoji}</span>
                    </DockIcon>
                  ))}
                </Dock>
              </Demo>
              <Demo title="BlurFade" lib="magicui" importPath="@/components/magicui/blur-fade">
                <BlurFade delay={0.1}>
                  <div className="text-2xl font-bold">Blur-fades in</div>
                </BlurFade>
              </Demo>
              <Demo title="AvatarCircles" lib="magicui" importPath="@/components/magicui/avatar-circles">
                <AvatarCircles
                  numPeople={42}
                  avatarUrls={[
                    { imageUrl: 'https://avatars.githubusercontent.com/u/16860528', profileUrl: '#' },
                    { imageUrl: 'https://avatars.githubusercontent.com/u/20110627', profileUrl: '#' },
                    { imageUrl: 'https://avatars.githubusercontent.com/u/106103625', profileUrl: '#' },
                  ]}
                />
              </Demo>
              <Demo title="Compare" lib="aceternity" importPath="@/components/aceternity/compare">
                <Compare
                  firstImage="https://assets.aceternity.com/code-problem.png"
                  secondImage="https://assets.aceternity.com/code-solution.png"
                  firstImageClassName="object-cover object-left-top"
                  secondImageClassname="object-cover object-left-top"
                  className="h-44 w-72 md:w-[400px]"
                  slideMode="hover"
                />
              </Demo>
              <Demo title="FollowerPointerCard" lib="aceternity" importPath="@/components/aceternity/following-pointer">
                <FollowerPointerCard title="KSCW">
                  <div className="rounded-lg border bg-card p-6">
                    <div className="text-base font-semibold">Custom cursor</div>
                    <div className="text-sm text-muted-foreground">Move inside this card.</div>
                  </div>
                </FollowerPointerCard>
              </Demo>
              <Demo title="HoverEffect" lib="aceternity" importPath="@/components/aceternity/card-hover-effect">
                <HoverEffect className="!py-0 !grid-cols-1 sm:!grid-cols-2 gap-2 w-full" items={[
                  { title: 'Trainings', description: '5 this week', link: '#' },
                  { title: 'Spielplan', description: '3 games', link: '#' },
                ]} />
              </Demo>
              <Demo title="LampContainer" lib="aceternity" importPath="@/components/aceternity/lamp">
                <LampContainer className="!min-h-0 h-full">
                  <div className="text-base font-semibold">Lamp glow</div>
                </LampContainer>
              </Demo>
              <Demo title="ScrollProgress" lib="magicui" importPath="@/components/magicui/scroll-progress">
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
                Icon={() => <div className="text-3xl">🏐</div>}
                className="col-span-1 row-span-1"
                href="#"
                cta="View"
                background={<MagicMeteors number={10} />}
              />
              <BentoCard
                name="Trainings"
                description="12 this week"
                Icon={() => <div className="text-3xl">📅</div>}
                className="col-span-1 row-span-1"
                href="#"
                cta="View"
                background={<div className="absolute inset-0"><DotPattern /></div>}
              />
              <BentoCard
                name="Hallenplan"
                description="Live slot conflicts"
                Icon={() => <div className="text-3xl">📊</div>}
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
                <div className="text-[10px] text-muted-foreground truncate">@/components/magicui/{name}</div>
              </a>
            ))}
          </div>
        </TabsContent>

        {/* ── Aceternity catalog ───────────────────────────────────── */}
        <TabsContent value="aceternity">
          <p className="mb-3 text-sm text-muted-foreground">
            All {ACETERNITY_ALL.length} Aceternity components — import path + docs link.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filteredAce.map((name) => (
              <a
                key={name}
                href={`https://ui.aceternity.com/components/${name}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border bg-card px-3 py-2 hover:bg-accent transition-colors"
              >
                <div className="font-mono text-sm font-medium">{name}</div>
                <div className="text-[10px] text-muted-foreground truncate">@/components/aceternity/{name}</div>
              </a>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
