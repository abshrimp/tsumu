/** Manual articles grouped by their help-center category. */
import type { Topic } from "./manual";
import { startTopics } from "./manual-topics/start";
import { pageTopics } from "./manual-topics/page";
import { elementTopics } from "./manual-topics/element";
import { textTopics } from "./manual-topics/text";
import { layoutTopics } from "./manual-topics/layout";
import { lookTopics } from "./manual-topics/look";
import { imageTopics } from "./manual-topics/image";
import { responsiveTopics } from "./manual-topics/responsive";
import { actionTopics } from "./manual-topics/action";
import { dataTopics } from "./manual-topics/data";
import { reuseTopics } from "./manual-topics/reuse";
import { publishTopics } from "./manual-topics/publish";
import { designTopics } from "./manual-topics/design";

export const TOPICS: Topic[] = [
  ...startTopics,
  ...pageTopics,
  ...elementTopics,
  ...textTopics,
  ...layoutTopics,
  ...lookTopics,
  ...imageTopics,
  ...responsiveTopics,
  ...actionTopics,
  ...dataTopics,
  ...reuseTopics,
  ...publishTopics,
  ...designTopics,
];
