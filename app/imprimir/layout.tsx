export default function ImprimirLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-white text-slate-900">{children}</div>;
}
