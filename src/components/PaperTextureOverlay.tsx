export default function PaperTextureOverlay() {
  // Dark mode: no paper texture needed. Render a minimal background layer.
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0"
      style={{
        zIndex: 0,
        background: 'var(--background)',
      }}
    />
  );
}
