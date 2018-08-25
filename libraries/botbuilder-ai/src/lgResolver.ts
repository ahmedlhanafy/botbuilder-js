/**
 * @module botbuilder-ai
 *
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { Activity as IActivity } from 'botbuilder';

/**
 * ## Notes:
 *  1) This code just demonstrates how this module will be built, changes to the internals might occur, however, the public classes will remain as is.
 *  2) This module still lacks proper comments and doesn't fully adhere to TSLint rules; this will change in the final PR.
 *
 * ## Questions:
 *  1) Is there an API that can request multiple slots in the same HTTP call?
 */

//  ######################################### EXPORTED API #########################################

export type PrimitiveArray = string[] | number[] | boolean[] | Date[];

export class LGEndpoint {
  private _endpointKey: string;
  private _lgAppId: string;
  private _endpointUri: string;

  constructor(endpointKey: string, lgAppId: string, endpointUri: string) {
    this.validateInputs(endpointKey, lgAppId, endpointUri);
    this._endpointKey = endpointKey;
    this._lgAppId = lgAppId;
    this._endpointUri = endpointUri;
  }

  private validateInputs(
    endpointKey: string,
    lgAppId: string,
    endpointUri: string,
  ): void {
    // throw new Error('Method not implemented.');
  }

  public get endpointKey(): string {
    return this._endpointKey;
  }

  public get lgAppId(): string {
    return this._lgAppId;
  }

  public get endpointUri(): string {
    return this._endpointUri;
  }
}

export class LGOptions {}

export class LGResolver {
  private lgApi: LGAPI;
  constructor(lgEndpoint: LGEndpoint, lgOptions: LGOptions) {
    this.lgApi = new LGAPI(lgEndpoint, lgOptions);
  }

  public async resolve(
    activity: Activity,
    entities: Map<string, PrimitiveArray>,
  ): Promise<void> {
    const slots = SlotBuilder.extractSlots(activity, entities);

    const requestPromises = slots
      .map(slot => new LGRequest(slot))
      .map(this.lgApi.fetch);
    const responses = await Promise.all(requestPromises);

    console.log(responses);

    // ActivityModifier.injectResponses(activity, responses);
  }
}

//  ######################################### INTERNAL API #########################################

//  ----------------------------------------- Activity Inspectors -----------------------------------------
type IActivityInspector = (activity: Activity) => string[];

const textInspector: IActivityInspector = (activity: Activity): string[] => {
  const text = activity.text || '';
  return PatternRecognizer.extractPatterns(text);
};

const speakInspector: IActivityInspector = (activity: Activity): string[] => {
  const text = activity.speak || '';
  return PatternRecognizer.extractPatterns(text);
};

const cardInspector: IActivityInspector = (activity: Activity): string[] => {
  if (activity.suggestedActions && activity.suggestedActions.actions) {
    return activity.suggestedActions.actions.reduce((acc, action) => {
      acc.concat(PatternRecognizer.extractPatterns(action.text));
      acc.concat(PatternRecognizer.extractPatterns(action.displayText));
      return acc;
    }, []);
  }

  return [];
};

//  ----------------------------------------- Activity Injectors -----------------------------------------
type IActivityInjector = (
  activity: Activity,
  templateResolution: string,
) => void;

const textInjector: IActivityInjector = (
  activity: Activity,
  templateResolution: string,
): void => {
  const text = activity.text;
  if (text) {
    PatternRecognizer.replacePatterns(text, templateResolution);
  }
};

const speakInjector: IActivityInjector = (
  activity: Activity,
  templateResolution: string,
): void => {
  const speak = activity.speak;
  if (speak) {
    PatternRecognizer.replacePatterns(speak, templateResolution);
  }
};

const cardInjector: IActivityInjector = (
  activity: Activity,
  templateResolution: string,
): void => {
  if (activity.suggestedActions && activity.suggestedActions.actions) {
    activity.suggestedActions.actions.forEach(action => {
      PatternRecognizer.replacePatterns(action.text, templateResolution);
      PatternRecognizer.replacePatterns(action.displayText, templateResolution);
    });
  }
};

//  ----------------------------------------- Helpers -----------------------------------------
class SlotBuilder {
  // Searches for template references inside the activity and constructs slots
  public static extractSlots(
    activity: Activity,
    entities: Map<string, PrimitiveArray>,
  ): Slot[] {
    // Utilize activity inspectors to extract the template references
    const inspectors = [
      ...textInspector(activity),
      ...speakInspector(activity),
      ...cardInspector(activity),
    ];

    const stateNames = new Set(inspectors);
    const slots: Slot[] = [];

    stateNames.forEach(stateName => {
      slots.push(new Slot(stateName, entities));
    });

    return slots;
  }
}

export class PatternRecognizer {
  static readonly regex = /[^[\]]+(?=])/g;
  // Recognizes and returns template references
  public static extractPatterns(text: string): string[] {
    let templateReferences = [];
    let regexExecArr: RegExpExecArray;

    while ((regexExecArr = this.regex.exec(text)) !== null) {
      if (regexExecArr.index === this.regex.lastIndex) {
        this.regex.lastIndex++;
      }

      regexExecArr.forEach(match => templateReferences.push(match));
    }

    return templateReferences;
  }

  public static replacePatterns(
    originalText: string,
    templateResolution: string,
  ) {
    originalText.replace(this.regex, templateResolution);
  }
}

class ActivityModifier {
  // Searches for template references inside the activity and replaces them with the actual text coming from the LG backend
  public static injectResponses(
    activity: Activity,
    responses: LGResponse[],
  ): void {
    // responses 
  }
}

// Not implemented
class Slot {
  constructor(
    public stateName: string,
    public entities: Map<string, PrimitiveArray>,
  ) {}
}

//  ----------------------------------------- LG API -----------------------------------------
// Not implemented
class LGRequest {
  _fields: Map<string, string>;
  constructor(private slot: Slot) {
    this._fields = new Map<string, string>();
    this._fields.set('GetStateName', slot.stateName);
    slot.entities.forEach((val, key) =>
      this._fields.set(key, val[0].toString()),
    );
  }

  get fields() {
    return this._fields;
  }
}

// Not implemented
class LGResponse {
  constructor(public stateResolution: string) {}
}

// Not implemented
class LGAPI {
  constructor(private lgEndpoint: LGEndpoint, private lgOptions: LGOptions) {}

  public async fetch(request: LGRequest): Promise<LGResponse> {
    return Promise.resolve(new LGResponse('hello awesome people'));
  }
}

const describe = (text: string, cb: () => void) => {
  console.log(`> ${text}`);
  try {
    cb();
    console.log('All tests passed');
  } catch (e) {
    console.log('Some tests failed');
  }
};

const it = (text: string, cb: () => void) => {
  try {
    console.log(`   - ${text}`);
    cb();
  } catch (e) {
    console.error(e);
  }
};

const expect = val => {
  return {
    toBe: comparedVal => {
      if (val !== comparedVal)
        throw new Error(`    ${val} isn't ${comparedVal}`);
    },
    toEqual: comparedVal => {
      if (val != comparedVal)
        throw new Error(`    ${val} doesn't equal ${comparedVal}`);
    },
  };
};

describe('Pattern Recognizer', () => {
  it('extracts all template references', () => {
    const templateReferences = PatternRecognizer.extractPatterns(
      '[sayGoodMorning], John!',
    );

    expect(templateReferences[0]).toEqual('sayGoodMorning');

    const templateReferences1 = PatternRecognizer.extractPatterns(
      '[sayHello], John! [welcomePhrase] to the new office.',
    );

    expect(templateReferences1[0]).toEqual('sayHello');
    expect(templateReferences1[1]).toEqual('welcomePhrase');

    const templateReferences2 = PatternRecognizer.extractPatterns(
      '[sayGoodBye], John! [thankingPhrase] for your time, [scheduleMeeting].',
    );
    expect(templateReferences2[0]).toEqual('sayGoodBye');
    expect(templateReferences2[1]).toEqual('thankingPhrase');
    expect(templateReferences2[2]).toEqual('scheduleMeeting');
  });

  it('returns empty array if no template references was found', () => {
    const templateReferences = PatternRecognizer.extractPatterns(
      'Hello John, welcome to BF!',
    );
    expect(templateReferences.length).toBe(0);
  });
});

class Activity implements IActivity {
  type: string;
  id?: string;
  timestamp?: Date;
  localTimestamp?: Date;
  serviceUrl: string;
  channelId: string;
  from: import('../../botframework-schema/src').ChannelAccount;
  conversation: import('../../botframework-schema/src').ConversationAccount;
  recipient: import('../../botframework-schema/src').ChannelAccount;
  textFormat?: string;
  attachmentLayout?: string;
  membersAdded?: import('../../botframework-schema/src').ChannelAccount[];
  membersRemoved?: import('../../botframework-schema/src').ChannelAccount[];
  reactionsAdded?: import('../../botframework-schema/src').MessageReaction[];
  reactionsRemoved?: import('../../botframework-schema/src').MessageReaction[];
  topicName?: string;
  historyDisclosed?: boolean;
  locale?: string;
  text: string;
  speak?: string;
  inputHint?: string;
  summary?: string;
  suggestedActions?: import('../../botframework-schema/src').SuggestedActions;
  attachments?: import('../../botframework-schema/src').Attachment[];
  entities?: import('../../botframework-schema/src').Entity[];
  channelData?: any;
  action?: string;
  replyToId?: string;
  label: string;
  valueType: string;
  value?: any;
  name?: string;
  relatesTo?: import('../../botframework-schema/src').ConversationReference;
  code?: string;
  expiration?: Date;
  importance?: string;
  deliveryMode?: string;
  textHighlights?: import('../../botframework-schema/src').TextHighlight[];
}

describe('LGResolver', () => {
  it('', () => {
    const resolver = new LGResolver(
      new LGEndpoint('', '', ''),
      new LGOptions(),
    );

    const activity = new Activity();
    activity.text = '[sayHello], John! [welcomePhrase] to the new office.';

    const entities = new Map<string, PrimitiveArray>();
    entities.set('name', ['john']);
    entities.set('city', ['paris']);
    entities.set('tickets', [3]);

    resolver.resolve(activity, entities).then(() => {});
  });
});
