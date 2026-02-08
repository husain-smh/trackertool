export default function MonitorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ zoom: 0.9 }}>
      {children}
    </div>
  );
}
