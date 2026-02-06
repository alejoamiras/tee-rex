import { configure, getConsoleSink, getJsonLinesFormatter } from "@logtape/logtape";

export async function setupLogging() {
  const isDev = process.env.NODE_ENV !== "production";

  let formatter: ReturnType<typeof getJsonLinesFormatter> | undefined;
  if (isDev) {
    const { prettyFormatter } = await import("@logtape/pretty");
    formatter = prettyFormatter;
  } else {
    formatter = getJsonLinesFormatter();
  }

  await configure({
    sinks: {
      console: getConsoleSink({ formatter }),
    },
    loggers: [
      {
        category: ["logtape", "meta"],
        sinks: ["console"],
        lowestLevel: "warning",
      },
      {
        category: ["tee-rex"],
        sinks: ["console"],
        lowestLevel: "info",
      },
      {
        category: ["express"],
        sinks: ["console"],
        lowestLevel: "info",
      },
    ],
  });
}
