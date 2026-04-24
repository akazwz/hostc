import { type FormEvent, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { Route } from "./+types/waitlist";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Join the Waitlist — hostc" },
		{
			name: "description",
			content:
				"Sign up for early access to custom subdomains and user accounts on hostc.",
		},
		{ property: "og:title", content: "Join the Waitlist — hostc" },
		{
			property: "og:description",
			content:
				"Sign up for early access to custom subdomains and user accounts on hostc.",
		},
		{ property: "og:image", content: "https://hostc.dev/og-image-waitlist.png" },
		{ name: "twitter:card", content: "summary_large_image" },
		{ name: "twitter:image", content: "https://hostc.dev/og-image-waitlist.png" },
	];
}

export default function Waitlist() {
	return (
		<div className="max-w-5xl mx-auto px-8 py-24 flex flex-col items-center text-center">
			<p className="text-xs uppercase tracking-widest text-muted-foreground mb-6">
				Coming Soon
			</p>
			<h1 className="font-heading text-4xl md:text-5xl font-bold mb-6 max-w-lg">
				Custom subdomains &amp; user accounts.
			</h1>
			<p className="text-muted-foreground max-w-sm mb-12 text-base">
				Persistent tunnels, custom URLs, and team access — leave your email to
				be the first to get beta access.
			</p>
			<WaitlistForm />
		</div>
	);
}

function WaitlistForm() {
	const [email, setEmail] = useState("");
	const [errorMessage, setErrorMessage] = useState("");
	const [status, setStatus] = useState<
		"idle" | "loading" | "success" | "error"
	>("idle");

	async function handleSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (!email) return;
		setErrorMessage("");
		setStatus("loading");
		try {
			const res = await fetch("/api/waitlist", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email }),
			});

			if (res.ok) {
				setStatus("success");
				return;
			}

			const data = (await res.json().catch(() => null)) as
				| { error?: string }
				| null;

			setErrorMessage(data?.error || "Something went wrong. Please try again.");
			setStatus("error");
		} catch {
			setErrorMessage("Something went wrong. Please try again.");
			setStatus("error");
		}
	}

	if (status === "success") {
		return (
			<Alert className="w-full max-w-sm">
				<AlertTitle>🎉 You're on the list!</AlertTitle>
				<AlertDescription>We'll be in touch when it's ready.</AlertDescription>
			</Alert>
		);
	}

	return (
		<form
			onSubmit={handleSubmit}
			className="flex flex-col gap-2 w-full max-w-sm"
		>
			<div className="flex flex-col sm:flex-row gap-2 w-full">
				<Input
					type="email"
					placeholder="you@example.com"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					required
					disabled={status === "loading"}
					className="flex-1"
				/>
				<Button type="submit" disabled={status === "loading"}>
					{status === "loading" ? "Joining…" : "Join Waitlist"}
				</Button>
			</div>
			{status === "error" && (
				<Alert variant="destructive">
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			)}
		</form>
	);
}
