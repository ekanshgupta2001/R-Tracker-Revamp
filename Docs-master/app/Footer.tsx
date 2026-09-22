export function Footer({ className }: { className?: string }) {
  return (
    <footer className={`mt-auto border-t border-fd-border py-6 px-6 text-center text-sm text-fd-muted-foreground ${className ?? ''}`}>
      &copy; 2026 Pedro Pathing. Pedro Pathing is licensed under the BSD 3-Clause License. The Pedro Pathing name and logo are trademarks of Pedro Pathing.
    </footer>
  );
}
