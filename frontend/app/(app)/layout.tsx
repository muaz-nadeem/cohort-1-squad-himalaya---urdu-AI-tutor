import Navbar from "@/components/Navbar";

/**
 * Shared chrome for every signed-in tab. Living in a layout means React keeps
 * the sidebar mounted across navigations — only the page body swaps, so tab
 * switches repaint instantly instead of tearing down and rebuilding the shell.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Navbar>{children}</Navbar>;
}
