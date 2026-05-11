import { MenuIcon } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { GithubIcon } from "~/components/icons";
import { Button } from "~/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "~/components/ui/sheet";
import { cn } from "~/lib/utils";

const docsNav = [
	{
		title: "Quick start",
		href: "/docs",
		description: "Create a public tunnel.",
	},
	{
		title: "CLI",
		href: "/docs/cli",
		description: "Commands, options, config.",
	},
	{
		title: "SDK",
		href: "/docs/sdk",
		description: "Embed tunnels in apps.",
	},
	{
		title: "Self-hosting",
		href: "/docs/self-hosting",
		description: "Use your own server URL.",
	},
	{
		title: "Limits",
		href: "/docs/limits",
		description: "Preview behavior and boundaries.",
	},
];

export default function DocsRouteLayout() {
	return (
		<div className="relative min-h-screen bg-background text-foreground">
			<div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_45%)]" />
			<div className="fixed inset-0 pointer-events-none bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[48px_48px]" />

			<header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
				<div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
					<div className="flex min-w-0 items-center gap-3">
						<MobileDocsNav />
						<Link
							to="/"
							className="font-heading text-xl font-bold tracking-tight transition-opacity hover:opacity-80"
						>
							hostc
						</Link>
						<span className="hidden h-4 w-px bg-border sm:block" />
						<span className="hidden text-xs font-semibold uppercase tracking-widest text-muted-foreground sm:block">
							Docs
						</span>
					</div>

					<Button
						variant="ghost"
						size="sm"
						nativeButton={false}
						render={(props) => (
							<a
								{...props}
								href="https://github.com/akazwz/hostc"
								target="_blank"
								rel="noreferrer"
							/>
						)}
					>
						<GithubIcon />
						<span className="hidden sm:inline">GitHub</span>
					</Button>
				</div>
			</header>

			<div className="relative z-10 mx-auto grid max-w-7xl lg:grid-cols-[240px_minmax(0,1fr)]">
				<aside className="hidden border-r border-border/80 lg:block">
					<div className="sticky top-14 h-[calc(100svh-3.5rem)] overflow-y-auto px-6 py-8">
						<p className="mb-5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Documentation
						</p>
						<DocsNav />
					</div>
				</aside>

				<main className="min-w-0">
					<Outlet />
				</main>
			</div>
		</div>
	);
}

function MobileDocsNav() {
	const [open, setOpen] = useState(false);

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger
				render={
					<Button
						variant="outline"
						size="icon-sm"
						className="lg:hidden"
					/>
				}
			>
				<MenuIcon />
				<span className="sr-only">Open docs navigation</span>
			</SheetTrigger>
			<SheetContent side="left" className="w-[min(86vw,22rem)]">
				<SheetHeader className="border-b border-border">
					<SheetTitle>hostc docs</SheetTitle>
					<SheetDescription>
						CLI usage, SDK integration, server URL, and preview limits.
					</SheetDescription>
				</SheetHeader>
				<DocsNav mobile onNavigate={() => setOpen(false)} className="px-4 py-4" />
			</SheetContent>
		</Sheet>
	);
}

function DocsNav({
	mobile = false,
	onNavigate,
	className,
}: {
	mobile?: boolean;
	onNavigate?: () => void;
	className?: string;
}) {
	return (
		<nav className={cn("grid gap-1", className)}>
			{docsNav.map((item) => (
				<NavLink
					key={item.href}
					to={item.href}
					end={item.href === "/docs"}
					onClick={onNavigate}
					className={({ isActive }) =>
						cn(
							"group border-l px-4 py-3 transition-colors hover:border-foreground hover:bg-muted/30",
							mobile && "border border-border border-l-border",
							isActive
								? "border-foreground bg-muted/40"
								: "border-border",
						)
					}
				>
					{({ isActive }) => <DocsNavItem item={item} active={isActive} />}
				</NavLink>
			))}
		</nav>
	);
}

function DocsNavItem({
	item,
	active,
}: {
	item: {
		title: string;
		description: string;
	};
	active: boolean;
}) {
	return (
		<>
			<span
				className={cn(
					"block text-sm font-medium transition-colors",
					active ? "text-foreground" : "text-foreground/85",
				)}
			>
				{item.title}
			</span>
			<span
				className={cn(
					"mt-1 block text-xs leading-relaxed transition-colors",
					active
						? "text-muted-foreground"
						: "text-muted-foreground group-hover:text-foreground/70",
				)}
			>
				{item.description}
			</span>
		</>
	);
}
