import ParentShare from "./share";

// Next.js App Router geeft `params` als een plain object (geen Promise).
export default function Join({ params }: { params: { code: string } }) {
  return <ParentShare code={params.code} />;
}
