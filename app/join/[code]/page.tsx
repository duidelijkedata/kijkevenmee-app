// app/join/[code]/page.tsx

export default async function Page(props: PageProps<"/join/[code]">) {
  const { code } = await props.params;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <div>Join code: {code}</div>
    </main>
  );
}
