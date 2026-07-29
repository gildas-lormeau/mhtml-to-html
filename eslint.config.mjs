import js from "@eslint/js";

export default [
	{
		ignores: ["**/vendor/**"]
	},
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 2025,
			sourceType: "module",
			globals: {
				console: "readonly",
			}
		},
		rules: {
			"linebreak-style": [
				"error",
				"unix"
			],
			"quotes": [
				"error",
				"double"
			],
			"semi": [
				"error",
				"always"
			],
			"no-console": [
				"warn"
			]
		}
	},
	{
		// the tests build MHTML documents out of markup, which reads better untouched by escaping
		files: ["test/**"],
		languageOptions: {
			globals: {
				atob: "readonly",
				btoa: "readonly",
				crypto: "readonly",
				setTimeout: "readonly",
				TextDecoder: "readonly",
				TextEncoder: "readonly"
			}
		},
		rules: {
			"quotes": [
				"error",
				"double",
				{
					allowTemplateLiterals: true
				}
			]
		}
	}
];
