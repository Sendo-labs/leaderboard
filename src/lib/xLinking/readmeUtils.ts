import { z } from "zod";

export const LinkedXAccountSchema = z.object({
  xUsername: z.string().min(1),
  xUserId: z.string().min(1),
  linkedAt: z.string().datetime(),
  linkingProof: z.string().min(1), // JWT token
});

export const XLinkingDataSchema = z.object({
  lastUpdated: z.string().datetime(),
  xAccount: LinkedXAccountSchema,
});

export type LinkedXAccount = z.infer<typeof LinkedXAccountSchema>;
export type XLinkingData = z.infer<typeof XLinkingDataSchema>;

const X_SECTION_BEGIN_MARKER = "<!-- X-LINKING-BEGIN";
const X_SECTION_END_MARKER = "X-LINKING-END -->";

/**
 * Parses X linking data from a given README content string.
 * Data is expected to be in JSON format within specific comment markers.
 * @param readmeContent The string content of the README file.
 * @returns The parsed and validated X linking data, or null if no valid data found.
 */
export function parseXLinkingDataFromReadme(
  readmeContent: string,
): XLinkingData | null {
  const startIndex = readmeContent.indexOf(X_SECTION_BEGIN_MARKER);
  const endIndex = readmeContent.indexOf(X_SECTION_END_MARKER);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null;
  }

  const xSectionContent = readmeContent
    .substring(startIndex + X_SECTION_BEGIN_MARKER.length, endIndex)
    .trim();

  try {
    // Parse the JSON directly from the comment content
    const rawData = JSON.parse(xSectionContent);

    // Validate the data structure using Zod
    const result = XLinkingDataSchema.safeParse(rawData);

    if (!result.success) {
      console.error("Invalid X linking data:", result.error);
      return null;
    }

    return result.data;
  } catch (error) {
    console.error("Error parsing X linking data:", error);
    return null;
  }
}

/**
 * Generates an updated README content string with the provided X linking data.
 * It will replace an existing X section if found, or append a new one.
 * The X information is stored as JSON in a hidden HTML comment.
 * @param currentReadme The current content of the README file.
 * @param xAccount The X account information to store.
 * @returns The updated README content string.
 */
export function generateUpdatedReadmeWithXInfo(
  currentReadme: string,
  xAccount: LinkedXAccount,
): { updatedReadme: string; xData: XLinkingData } {
  // Validate X account using Zod before generating content
  const validatedXAccount = LinkedXAccountSchema.parse(xAccount);

  const xData: XLinkingData = {
    lastUpdated: new Date().toISOString(),
    xAccount: validatedXAccount,
  };

  // Validate the complete data structure
  const validatedData = XLinkingDataSchema.parse(xData);

  const xSection = `${X_SECTION_BEGIN_MARKER}
${JSON.stringify(validatedData, null, 2)}
${X_SECTION_END_MARKER}`;

  const startIndex = currentReadme.indexOf(X_SECTION_BEGIN_MARKER);
  const endIndex = currentReadme.indexOf(X_SECTION_END_MARKER);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    // Replace existing section
    const updatedReadme =
      currentReadme.substring(0, startIndex) +
      xSection +
      currentReadme.substring(endIndex + X_SECTION_END_MARKER.length);
    return { updatedReadme, xData };
  } else {
    // Append new section
    const separator =
      currentReadme.trim() && !currentReadme.endsWith("\n")
        ? "\n\n"
        : currentReadme.trim()
          ? "\n"
          : "";
    return {
      updatedReadme: currentReadme.trim() + separator + xSection,
      xData,
    };
  }
}

/**
 * Generates the X section content for a README file
 * @param xAccount The X account information to store
 * @returns The formatted X section string with markers
 */
export function generateReadmeXSection(xAccount: LinkedXAccount): string {
  // Validate X account using Zod before generating content
  const validatedXAccount = LinkedXAccountSchema.parse(xAccount);

  const xData: XLinkingData = {
    lastUpdated: new Date().toISOString(),
    xAccount: validatedXAccount,
  };

  // Validate the complete data structure
  const validatedData = XLinkingDataSchema.parse(xData);

  return `${X_SECTION_BEGIN_MARKER}
${JSON.stringify(validatedData, null, 2)}
${X_SECTION_END_MARKER}`;
}
