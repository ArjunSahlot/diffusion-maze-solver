import { Playground } from "@/components/Playground";

const GITHUB = "https://github.com/ArjunSahlot/diffusion-maze-solver";
const SPACE = "https://huggingface.co/spaces/ArjunSahlot/diffusion-maze-solver";

const NOTES = [
  {
    title: "The board is the condition",
    body: "Walls and endpoints are fed in as two fixed channels. A third channel, the path, is the only thing the model is ever asked to produce.",
  },
  {
    title: "There is no search",
    body: "No frontier, no queue, no backtracking. The path is guessed everywhere at once and sharpened over a handful of denoising steps.",
  },
  {
    title: "It runs on this page",
    body: "The network is downloaded once and executed in your browser through WebGPU, or WebAssembly where that is unavailable. Nothing you draw leaves the tab.",
  },
];

const FACTS = [
  ["Architecture", "U-Net, 5,218,561 parameters"],
  ["Board", "23 × 23 pixels, an 11 × 11 cell maze"],
  ["Training set", "20,000 mazes carved by recursive backtracker, solved by A*"],
  ["Sampler", "DDIM, η = 1, 32 of the 1000 trained timesteps"],
  ["Solve rate", "94.1% of 256 held-out mazes, against 94.5% using all 1000 steps"],
];

export default function Home() {
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-6">
          <span className="font-mono text-[0.8125rem] whitespace-nowrap sm:text-sm">diffusion-maze-solver</span>
          <nav className="flex items-center gap-4 text-sm whitespace-nowrap text-muted sm:gap-5">
            <a className="transition-colors hover:text-foreground" href={GITHUB}>
              GitHub
            </a>
            <a className="transition-colors hover:text-foreground" href={SPACE}>
              Hugging Face
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6">
        <section className="pt-16 pb-10 sm:pt-24">
          <h1 className="text-4xl font-medium tracking-[-0.02em] text-balance sm:text-5xl">
            Pathfinding through denoising
          </h1>
          <p className="mt-5 max-w-xl text-[1.0625rem] leading-7 text-muted text-pretty">
            A diffusion model that solves mazes. It was never taught to search; it was taught what a
            solved maze looks like, and it recovers the path from pure noise. Draw a maze below, or
            let it finish one for you, then watch the route resolve.
          </p>
        </section>

        <section className="flex justify-center pb-16">
          <Playground />
        </section>

        <section className="grid gap-8 border-t border-line py-14 sm:grid-cols-3">
          {NOTES.map((note) => (
            <div key={note.title}>
              <h2 className="text-sm font-medium">{note.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted text-pretty">{note.body}</p>
            </div>
          ))}
        </section>

        <section className="border-t border-line py-14">
          <h2 className="text-sm font-medium">Specifics</h2>
          <dl className="mt-5 divide-y divide-line border-y border-line text-sm">
            {FACTS.map(([term, detail]) => (
              <div key={term} className="grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
                <dt className="text-muted">{term}</dt>
                <dd className="font-mono text-[0.8125rem] leading-6 min-w-0">{detail}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-6 text-sm text-muted">
          <span>Arjun Sahlot</span>
          <a className="transition-colors hover:text-foreground" href={`${GITHUB}/blob/main/LICENSE`}>
            MIT
          </a>
        </div>
      </footer>
    </>
  );
}
