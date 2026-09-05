import { Playground } from "@/components/Playground";
import { ThemeToggle } from "@/components/ThemeToggle";

const GITHUB = "https://github.com/ArjunSahlot/diffusion-maze-solver";
const SPACE = "https://huggingface.co/spaces/ArjunSahlot/diffusion-maze-solver";


const FACTS = [
  ["Architecture", "U-Net, 5,218,561 parameters"],
  ["Board", "23 × 23 pixels, an 11 × 11 cell maze"],
  ["Training set", "20,000 mazes carved by recursive backtracker, solved by A*"],
  ["Solve rate", "94.1% of 256 held-out mazes, against 94.5% using all 1000 steps"],
  ["Inference", "onnxruntime-web, WebGPU with a WebAssembly fallback. Nothing you draw leaves the tab."],
];

export default function Home() {
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-2 font-mono text-[0.8125rem] whitespace-nowrap">
            <a className="link-quiet" href="https://arjunsahlot.com">
              arjunsahlot
            </a>
            <span aria-hidden className="text-faint">
              /
            </span>
            <span className="truncate">maze-diffusion</span>
          </div>
          <nav className="flex shrink-0 items-center gap-4 text-sm whitespace-nowrap">
            <a className="link-quiet" href={GITHUB}>
              GitHub
            </a>
            <a className="link-quiet" href={SPACE}>
              Hugging&nbsp;Face
            </a>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6">
        <section className="pt-16 pb-10 sm:pt-24">
          <h1 className="rise text-4xl font-medium tracking-tight text-balance sm:text-5xl">
            Pathfinding through denoising
          </h1>
          <p className="rise mt-5 text-[1.0625rem] leading-7 text-muted" style={{ "--step": 1 } as React.CSSProperties}>
            A diffusion model that solves mazes. It was never taught to search; it was taught what a solved maze looks
            like, and it recovers the route from pure noise. Draw a maze below, or let it finish one for you, then watch
            the path resolve.
          </p>
        </section>

        <section className="rise flex justify-center pb-16" style={{ "--step": 2 } as React.CSSProperties}>
          <Playground />
        </section>

        <section className="border-t border-line py-14">
          <h2 className="text-sm font-medium">Specifics</h2>
          <dl className="mt-5 divide-y divide-line border-y border-line text-sm">
            {FACTS.map(([term, detail]) => (
              <div key={term} className="grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
                <dt className="text-muted">{term}</dt>
                <dd className="min-w-0 font-mono text-[0.8125rem] leading-6">{detail}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-6 text-sm text-muted">
          <a className="link-quiet" href="https://arjunsahlot.com">
            Arjun Sahlot
          </a>
          <a className="link-quiet" href={`${GITHUB}/blob/main/LICENSE`}>
            MIT
          </a>
        </div>
      </footer>
    </>
  );
}
