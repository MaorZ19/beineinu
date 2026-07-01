export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-12 text-center">
      <h1 className="text-3xl font-bold">Maori Ink Screen 💛</h1>
      <p className="text-neutral-600">
        רגעים אקראיים ויפים מהצ׳אט שלנו — על נייר דיו.
      </p>
      <p className="text-sm text-neutral-400">
        Live image: <code>/api/quote/random</code>
      </p>
    </main>
  );
}
