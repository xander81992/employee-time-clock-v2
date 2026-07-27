export default function LoadingScreen({ message = "Loading…" }: { message?: string }) {
  return (
    <main className="center-page">
      <div className="loading-card">
        <div className="spinner" aria-hidden="true" />
        <p>{message}</p>
      </div>
    </main>
  );
}
