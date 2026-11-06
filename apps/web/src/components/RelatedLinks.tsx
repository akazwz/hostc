import { For } from "solid-js";

export function RelatedLinks(props: { title: string; links: { href: string; label: string }[] }) {
	return (
		<section class="related">
			<h2>{props.title}</h2>
			<ul class="links">
				<For each={props.links}>
					{(link) => (
						<li>
							<a href={link.href}>{link.label}</a>
						</li>
					)}
				</For>
			</ul>
		</section>
	);
}
