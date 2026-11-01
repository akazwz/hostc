// A small tokenizer for code blocks: enough to make code readable, far less than a real grammar, and it
// keeps a highlighting library and its language packs out of a page that travels through a tunnel.

export type Token = { kind: "plain" | "keyword" | "string" | "comment" | "number"; text: string };

const KEYWORDS = new Set(
	"as async await break case catch class const continue def default defer del do elif else enum except export extends false final finally fn for from func function go if impl import in interface let match mod module mut new nil none not null of or package pub return self static struct super switch this throw trait true try type undefined use var void while with yield".split(
		" ",
	),
);

const HASH_COMMENT = new Set(["sh", "bash", "zsh", "py", "python", "rb", "ruby", "toml", "yaml", "yml"]);

export function tokenize(code: string, language = ""): Token[] {
	const comment = HASH_COMMENT.has(language.toLowerCase()) ? "#[^\\n]*" : "//[^\\n]*|/\\*[\\s\\S]*?\\*/";
	const pattern = new RegExp(
		`(${comment})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\b\\d[\\d_.]*\\b)|([A-Za-z_$][\\w$]*)`,
		"g",
	);
	const tokens: Token[] = [];
	let plain = "";
	let last = 0;
	const flush = () => {
		if (plain) {
			tokens.push({ kind: "plain", text: plain });
			plain = "";
		}
	};
	for (const match of code.matchAll(pattern)) {
		plain += code.slice(last, match.index);
		last = match.index + match[0].length;
		if (match[4] !== undefined && !KEYWORDS.has(match[4])) {
			plain += match[4];
			continue;
		}
		flush();
		tokens.push({
			kind:
				match[1] !== undefined
					? "comment"
					: match[2] !== undefined
						? "string"
						: match[3] !== undefined
							? "number"
							: "keyword",
			text: match[0],
		});
	}
	plain += code.slice(last);
	flush();
	return tokens;
}
