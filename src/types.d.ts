declare module 'docker-parse-image' {
	export default function parse(
		imgName: string
	): {
		registry: string;
		namespace: string;
		repository: string;
		tag: string;
	};
}
