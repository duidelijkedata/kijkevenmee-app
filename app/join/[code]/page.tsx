type PageProps = {
  params: { code: string };
};

export default function Page({ params }: PageProps) {
  const { code } = params;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      {/* jouw UI hier */}
      <div>Join code: {code}</div>
    </main>
  );
}
