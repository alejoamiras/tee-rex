import { describe, expect, test } from "bun:test";
import { resolvePublishVersion } from "./get-sdk-publish-version";

describe("resolvePublishVersion", () => {
	test("returns base version when not in published list", () => {
		expect(
			resolvePublishVersion("5.0.0-nightly.20260224", [
				"5.0.0-nightly.20260220",
			]),
		).toBe("5.0.0-nightly.20260224");
	});

	test("returns base version when published list is empty", () => {
		expect(resolvePublishVersion("5.0.0-nightly.20260224", [])).toBe(
			"5.0.0-nightly.20260224",
		);
	});

	test("returns .1 when base version already published, no revisions", () => {
		expect(
			resolvePublishVersion("5.0.0-nightly.20260224", [
				"5.0.0-nightly.20260224",
			]),
		).toBe("5.0.0-nightly.20260224.1");
	});

	test("returns .2 when .1 already published", () => {
		expect(
			resolvePublishVersion("5.0.0-nightly.20260224", [
				"5.0.0-nightly.20260224",
				"5.0.0-nightly.20260224.1",
			]),
		).toBe("5.0.0-nightly.20260224.2");
	});

	test("returns max+1 when there are gaps in revisions", () => {
		expect(
			resolvePublishVersion("5.0.0-nightly.20260224", [
				"5.0.0-nightly.20260224",
				"5.0.0-nightly.20260224.1",
				"5.0.0-nightly.20260224.3",
			]),
		).toBe("5.0.0-nightly.20260224.4");
	});

	test("works with nightly format", () => {
		expect(
			resolvePublishVersion("6.1.0-nightly.20260301", [
				"6.1.0-nightly.20260301",
				"6.1.0-nightly.20260301.1",
				"6.1.0-nightly.20260301.2",
			]),
		).toBe("6.1.0-nightly.20260301.3");
	});

	test("works with devnet format", () => {
		expect(
			resolvePublishVersion("4.0.0-devnet.2-patch.1", [
				"4.0.0-devnet.2-patch.1",
			]),
		).toBe("4.0.0-devnet.2-patch.1.1");
	});

	test("works with devnet format and existing revisions", () => {
		expect(
			resolvePublishVersion("4.0.0-devnet.2-patch.1", [
				"4.0.0-devnet.2-patch.1",
				"4.0.0-devnet.2-patch.1.1",
			]),
		).toBe("4.0.0-devnet.2-patch.1.2");
	});

	test("ignores unrelated versions in the list", () => {
		expect(
			resolvePublishVersion("5.0.0-nightly.20260224", [
				"4.0.0-devnet.2-patch.1",
				"5.0.0-nightly.20260220",
				"5.0.0-nightly.20260224",
				"5.0.0-nightly.20260224.1",
			]),
		).toBe("5.0.0-nightly.20260224.2");
	});
});
