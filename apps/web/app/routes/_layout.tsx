import { Link, Outlet } from "react-router";
import { Button } from "~/components/ui/button";
import { GithubIcon } from "~/components/icons";

export default function Layout() {
	return (
		<div className="relative min-h-screen bg-background text-foreground flex flex-col">
			<div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%)]" />
			<div className="fixed inset-0 pointer-events-none bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[48px_48px]" />
			<header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
				<div className="max-w-5xl mx-auto px-8 h-14 flex items-center justify-between">
					<Link
						to="/"
						className="font-heading text-xl font-bold tracking-tight hover:opacity-80 transition-opacity"
					>
						hostc
					</Link>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							nativeButton={false}
							render={<Link to="/waitlist" />}
						>
							Join Waitlist
						</Button>
						<Button
							variant="ghost"
							size="sm"
							nativeButton={false}
							render={
								<a
									href="https://github.com/akazwz/hostc"
									target="_blank"
									rel="noreferrer"
								/>
							}
						>
							<GithubIcon />
							GitHub
						</Button>
					</div>
				</div>
			</header>

			<main className="relative flex-1 z-10">
				<Outlet />
			</main>

			<footer className="relative z-10 border-t border-border">
				<div className="max-w-5xl mx-auto px-8 h-12 flex items-center justify-between text-xs text-muted-foreground">
					<span>© {new Date().getFullYear()} hostc</span>
					<a
						href="https://github.com/akazwz/hostc/blob/main/LICENSE"
						target="_blank"
						rel="noreferrer"
						className="hover:text-foreground transition-colors"
					>
						Apache 2.0
					</a>
				</div>
			</footer>
		</div>
	);
}

