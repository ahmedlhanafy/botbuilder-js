/**
 * @module botbuilder-ai
 *
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { Activity as IActivity } from '../../botbuilder';
import { replace, isEmpty } from 'lodash';

//  ######################################### EXPORTED API #########################################

export type PrimitiveType = string | number | boolean | Date;
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
    if (isEmpty(endpointKey)) {
      throw new Error(`Endpoint key can't be undefined or empty`);
    }

    if (isEmpty(lgAppId)) {
      throw new Error(`LG app ID can't be undefined or empty`);
    }

    if (isEmpty(endpointUri)) {
      throw new Error(`Endpoint URI can't be undefined or empty`);
    }
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
    entities: Map<string, PrimitiveType>,
  ): Promise<void> {
    const templateResolutions = new Map<string, string>();

    const slots = ActivityUtilities.extractSlots(activity, entities);

    const requestPromises = slots
      .map(slot => new LGRequest(slot))
      .map(this.lgApi.fetch);

    const responses = await Promise.all(requestPromises);

    responses.forEach(lgRes =>
      templateResolutions.set(lgRes.templateReference, lgRes.stateResolution),
    );

    ActivityUtilities.injectResponses(activity, templateResolutions);
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
      if (action.text) {
        acc.concat(PatternRecognizer.extractPatterns(action.text));
      }

      if (action.displayText) {
        acc.concat(PatternRecognizer.extractPatterns(action.displayText));
      }

      return acc;
    }, []);
  }

  return [];
};

//  ----------------------------------------- Activity Injectors -----------------------------------------
type IActivityInjector = (
  activity: Activity,
  templateResolutions: Map<string, string>,
) => void;

const textInjector: IActivityInjector = (
  activity: Activity,
  templateResolutions: Map<string, string>,
): void => {
  const text = activity.text;
  if (text) {
    activity.text = PatternRecognizer.replacePatterns(
      text,
      templateResolutions,
    );
  }
};

const speakInjector: IActivityInjector = (
  activity: Activity,
  templateResolutions: Map<string, string>,
): void => {
  const speak = activity.speak;
  if (speak) {
    activity.speak = PatternRecognizer.replacePatterns(
      speak,
      templateResolutions,
    );
  }
};

const cardInjector: IActivityInjector = (
  activity: Activity,
  templateResolutions: Map<string, string>,
): void => {
  if (activity.suggestedActions && activity.suggestedActions.actions) {
    activity.suggestedActions.actions.forEach(action => {
      if (action.text) {
        action.text = PatternRecognizer.replacePatterns(
          action.text,
          templateResolutions,
        );
      }
      if (action.displayText) {
        action.displayText = PatternRecognizer.replacePatterns(
          action.displayText,
          templateResolutions,
        );
      }
    });
  }
};

//  ----------------------------------------- Helpers -----------------------------------------
/**
 * @private
 */
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
    templateResolutions: Map<string, string>,
  ): string {
    let modifiedText = originalText;
    templateResolutions.forEach((stateResolution, templateReference) => {
      modifiedText = replace(
        modifiedText,
        `[${templateReference}]`,
        stateResolution,
      );
    });

    return modifiedText;
  }
}

/**
 * @private
 */
export class ActivityUtilities {
  // Searches for template references inside the activity and constructs slots
  public static extractSlots(
    activity: Activity,
    entities: Map<string, PrimitiveType>,
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

  // Searches for template references inside the activity and replaces them with the actual text coming from the LG backend
  public static injectResponses(
    activity: Activity,
    templateReferences: Map<string, string>,
  ): void {
    const injectors: IActivityInjector[] = [
      textInjector,
      speakInjector,
      cardInjector,
    ];

    injectors.forEach(injector => injector(activity, templateReferences));
  }
}

// Not implemented
class Slot {
  constructor(
    public stateName: string,
    public entities: Map<string, PrimitiveType>,
  ) {}
}

//  ----------------------------------------- LG API -----------------------------------------
// Not implemented
class LGRequest {
  public static readonly STATE_NAME_KEY = 'GetStateName';
  private _fields: Map<string, string>;
  constructor(slot: Slot) {
    this._fields = new Map<string, string>();
    this._fields.set(LGRequest.STATE_NAME_KEY, slot.stateName);
    slot.entities.forEach((val, key) => this._fields.set(key, val.toString()));
  }

  get fields() {
    return this._fields;
  }
}

// Not implemented
class LGResponse {
  constructor(public templateReference, public stateResolution: string) {}
}

// Not implemented
class LGAPI {
  constructor(private lgEndpoint: LGEndpoint, private lgOptions: LGOptions) {}

  public async fetch(request: LGRequest): Promise<LGResponse> {
    return Promise.resolve(
      new LGResponse(request.fields.get(LGRequest.STATE_NAME_KEY), 'hello'),
    );
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
  it('should extract all template references', () => {
    const templateReferences = PatternRecognizer.extractPatterns(
      '[sayGoodMorning], John!',
    );

    expect(templateReferences[0]).toEqual('sayGoodMorning');

    const templateReferences1 = PatternRecognizer.extractPatterns(
      '[sayHello], John! [welcomePhrase] to the {new} office.',
    );

    expect(templateReferences1[0]).toEqual('sayHello');
    expect(templateReferences1[1]).toEqual('welcomePhrase');
    expect(templateReferences1.length).toEqual(2);

    const templateReferences2 = PatternRecognizer.extractPatterns(
      '[sayGoodBye], John! [thankingPhrase] for your time, [scheduleMeeting].',
    );
    expect(templateReferences2[0]).toEqual('sayGoodBye');
    expect(templateReferences2[1]).toEqual('thankingPhrase');
    expect(templateReferences2[2]).toEqual('scheduleMeeting');
  });

  it('should return an empty array if no template references are found', () => {
    const templateReferences = PatternRecognizer.extractPatterns(
      'Hello John, welcome to BF!',
    );
    expect(templateReferences.length).toBe(0);
  });

  it('should replace all template references with their corresponding resolutions', () => {
    const templateReferences = new Map().set('sayGoodMorning', 'Hello');

    const newUtterance = PatternRecognizer.replacePatterns(
      '[sayGoodMorning], John!',
      templateReferences,
    );

    expect(newUtterance).toEqual('Hello, John!');

    const templateReferences1 = new Map()
      .set('sayHello', 'hello')
      .set('welcomePhrase', 'welcome');

    const newUtterance1 = PatternRecognizer.replacePatterns(
      '[sayHello], John! [welcomePhrase] to the {new} office.',
      templateReferences1,
    );

    expect(newUtterance1).toEqual('hello, John! welcome to the {new} office.');

    const templateReferences2 = new Map()
      .set('sayGoodBye', 'Bye')
      .set('thankingPhrase', 'thanks')
      .set('scheduleMeeting', `let's have a meeting`);

    const newUtterance2 = PatternRecognizer.replacePatterns(
      '[sayGoodBye], John! [thankingPhrase] for your time, [scheduleMeeting].',
      templateReferences2,
    );

    expect(newUtterance2).toEqual(
      `Bye, John! thanks for your time, let's have a meeting.`,
    );
  });
  it('should keep text as is if no template references are found', () => {
    const templateReferences = new Map().set('sayGoodMorning', 'Hello');

    const newUtterance = PatternRecognizer.replacePatterns(
      'Hello John, welcome to BF!',
      templateReferences,
    );

    expect(newUtterance).toEqual('Hello John, welcome to BF!');
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
      new LGEndpoint('qw', 'rt', 'yu'),
      new LGOptions(),
    );

    const activity = new Activity();
    activity.text = '[sayHello], John! [welcomePhrase] to the new office.';
    activity.speak = '[sayHi] Micheal, what is the weather like [today]';

    const entities = new Map<string, PrimitiveType>();

    resolver.resolve(activity, entities).then(() => {
      expect(activity.text).toEqual('hello, John! hello to the new office.');
      expect(activity.speak).toEqual(
        'hello Micheal, what is the weather like hello',
      );
    });
  });
});
