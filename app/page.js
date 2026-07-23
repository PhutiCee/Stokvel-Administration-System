export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-1/2 h-125 w-125 -translate-x-1/2 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-87.5 w-87.5 rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <h1 className="text-xl font-bold tracking-wide">
          SAS
        </h1>

        <button className="rounded-xl border border-slate-700 bg-slate-900/60 px-5 py-2 text-sm transition hover:border-blue-500 hover:bg-slate-800">
          Sign In
        </button>
      </nav>

      {/* Hero */}
      <section className="relative z-10 mx-auto flex min-h-[75vh] max-w-7xl flex-col items-center justify-center px-6 text-center">

        <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-1 text-sm text-blue-300 backdrop-blur">
          Honours Project
        </span>

        <h2 className="mt-8 max-w-5xl text-4xl font-extrabold leading-tight md:text-7xl">
          Stokvel
          <span className="bg-linear-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            {" "}
            Administration System
          </span>
        </h2>

        <p className="mt-8 max-w-3xl text-lg leading-8 text-slate-300 md:text-xl">
          Manages tenancy of clubs on the platform, creates and suspends clubs,
          monitors platform health, and produces anonymised aggregate reports.
          The system is intentionally designed without access to club level
          financial data, ensuring strong separation of administrative and
          financial responsibilities.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <button className="rounded-xl bg-blue-600 px-8 py-4 font-medium transition hover:bg-blue-500">
            Start Coding
          </button>

          <button className="rounded-xl border border-slate-700 px-8 py-4 transition hover:border-blue-500 hover:bg-slate-900">
            Learn More
          </button>
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-3">

          <div className="rounded-3xl border border-slate-800 bg-white/5 p-8 backdrop-blur">
            <div className="mb-5 flex m-auto h-14 w-14 items-center justify-center rounded-2xl bg-blue-600/20">
              🏛️
            </div>

            <h3 className="text-xl font-semibold">
              Club Administration
            </h3>

            <p className="mt-3 text-slate-400">
              Create, activate, suspend and manage tenancy of stokvel clubs
              across the platform from one secure administrative interface.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-white/5 p-8 backdrop-blur">
            <div className="mb-5 flex m-auto h-14 w-14 items-center justify-center rounded-2xl bg-cyan-600/20">
              📊
            </div>

            <h3 className="text-xl font-semibold">
              Platform Monitoring
            </h3>

            <p className="mt-3 text-slate-400">
              Monitor overall system availability, operational health and
              administrative activities through a centralised dashboard.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-white/5 p-8 backdrop-blur">
            <div className="mb-5 flex m-auto h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600/20">
              🔒
            </div>

            <h3 className="text-xl font-semibold">
              Privacy by Design
            </h3>

            <p className="mt-3 text-slate-400">
              Generates anonymised aggregate reports while preventing access to
              individual club financial information, reinforcing governance and
              data privacy.
            </p>
          </div>

        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-800 py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 text-sm text-slate-500 md:flex-row">
          <p>
            Stokvel Administration System
          </p>

          <p>
            Honours Software Engineering Project
          </p>
        </div>
      </footer>
    </main>
  );
}