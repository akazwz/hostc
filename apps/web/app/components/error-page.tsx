import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { GithubIcon } from "~/components/icons";

type ErrorPageProps = {
	statusCode: string;
	title: string;
	description: string;
	statusTone?: "danger" | "warning";
};

export function ErrorPage({
	statusCode,
	title,
	description,
	statusTone = "danger",
}: ErrorPageProps) {
	return (
		<div className="relative min-h-screen overflow-hidden bg-background text-foreground">
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%)]" />
			<div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[48px_48px]" />
			<main className="relative mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
				<Badge variant={statusTone === "danger" ? "destructive" : "secondary"}>
					{statusCode}
				</Badge>
				<h1 className="mt-6 font-heading text-4xl font-bold tracking-tight md:text-6xl">
					{title}
				</h1>
				<p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
					{description}
				</p>
				<div className="mt-10 flex flex-wrap items-center justify-center gap-3">
					<Button
						variant="outline"
						size="lg"
						nativeButton={false}
						render={<a href="https://hostc.dev/" />}
					>
						Open hostc.dev
					</Button>
					<Button
						variant="default"
						size="lg"
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
						View on GitHub
					</Button>
				</div>
			</main>
		</div>
	);
}