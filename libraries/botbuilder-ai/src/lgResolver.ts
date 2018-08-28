/**
 * @module botbuilder-ai
 *
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Tasks:
 *
 * 1) Add entities later in the pipeline -> Done
 * 2) Accomodate changes coming from the swagger file -> Done
 * 3) Update unit tests
 * 4) Create integration tests
 * 5) Change LG to LanguageGeneration -> Done
 * 6) Discuss keys situation with Amr
 * 7) Unify error messages
 */

import {
  Activity as IActivity,
  CardAction as ICardAction,
  SuggestedActions as ISuggestedActions,
} from '../../botbuilder';
import {
  isEmpty,
  isNil,
  replace,
  isBoolean,
  isNumber,
  isDate,
  isInteger,
  isString,
} from 'lodash';
import * as request from 'request-promise-native';

//  ######################################### EXPORTED API #########################################

export type PrimitiveType = string | number | boolean | Date;

export class LanguageGenerationEndpoint {
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

export class LanguageGenerationOptions {}

export class LanguageGenerationResolver {
  private lgApi: LGAPI;
  constructor(
    private lgEndpoint: LanguageGenerationEndpoint,
    private lgOptions: LanguageGenerationOptions,
  ) {
    this.lgApi = new LGAPI(lgEndpoint, lgOptions);
  }

  public async resolve(
    activity: IActivity,
    entities: Map<string, PrimitiveType>,
  ): Promise<void> {
    if (isNil(activity)) {
      throw new Error("Activity can't be null or undefined");
    }

    if (isNil(entities)) {
      throw new Error("Entities can't be null or undefined");
    }

    const templateResolutions = new Map<string, string>();

    const templateReferencesSlots = ActivityUtilities.extractTemplateReferencesSlots(
      activity,
    );

    const entitiesSlots = ActivityUtilities.convertEntitiesToSlots(entities);

    const requestPromises = templateReferencesSlots
      .map(templateReferences =>
        new LGRequestBuilder()
          .setScenario(this.lgEndpoint.lgAppId)
          .setLocale(activity.locale)
          .setSlots([templateReferences, ...entitiesSlots])
          .build(),
      )
      .map(this.lgApi.fetch);

    const responses = await Promise.all(requestPromises);

    responses.forEach(lgRes => {
      const templateReference = Object.keys(lgRes.outputs)[0];
      const templateResolution = lgRes.outputs[templateReference];

      templateResolutions.set(
        templateReference,
        Utilities.convertLGValueToString(templateResolution),
      );
    });

    ActivityUtilities.injectResponses(activity, templateResolutions);
  }
}

//  ######################################### INTERNAL API #########################################

//  ----------------------------------------- Activity Inspectors -----------------------------------------
type IActivityInspector = (activity: IActivity) => string[];

const textInspector: IActivityInspector = (activity: IActivity): string[] => {
  const text = activity.text || '';
  return PatternRecognizer.extractPatterns(text);
};

const speakInspector: IActivityInspector = (activity: IActivity): string[] => {
  const text = activity.speak || '';
  return PatternRecognizer.extractPatterns(text);
};

const suggestedActionsInspector: IActivityInspector = (
  activity: IActivity,
): string[] => {
  if (activity.suggestedActions && activity.suggestedActions.actions) {
    return activity.suggestedActions.actions.reduce((acc, action) => {
      if (action.text) {
        acc = [
          ...acc,
          ...acc.concat(PatternRecognizer.extractPatterns(action.text)),
        ];
      }

      if (action.displayText) {
        acc = [
          ...acc,
          ...acc.concat(PatternRecognizer.extractPatterns(action.displayText)),
        ];
      }

      return acc;
    }, []);
  }

  return [];
};

//  ----------------------------------------- Activity Injectors -----------------------------------------
type IActivityInjector = (
  activity: IActivity,
  templateResolutions: Map<string, string>,
) => void;

const textInjector: IActivityInjector = (
  activity: IActivity,
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
  activity: IActivity,
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

const suggestedActionsInjector: IActivityInjector = (
  activity: IActivity,
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

//  ----------------------------------------- Utilities -----------------------------------------
/**
 * @private
 */
export class PatternRecognizer {
  public static readonly regex = /[^[\]]+(?=])/g;

  public static extractPatterns(text: string): string[] {
    const templateReferences = [];
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
        this.constructTemplateReference(templateReference),
        stateResolution,
      );
    });

    return modifiedText;
  }

  private static constructTemplateReference = (text: string) => `[${text}]`;
}

/**
 * @private
 */
export class ActivityUtilities {
  static convertEntitiesToSlots(entities: Map<string, PrimitiveType>): any {
    throw new Error('Method not implemented.');
  }
  // Searches for template references inside the activity and constructs slots
  public static extractTemplateReferencesSlots(activity: IActivity): Slot[] {
    // Utilize activity inspectors to extract the template references
    const inspectors = [
      ...textInspector(activity),
      ...speakInspector(activity),
      ...suggestedActionsInspector(activity),
    ];

    const stateNames = new Set(inspectors);
    const slots: Slot[] = [];

    stateNames.forEach(stateName => {
      slots.push(new Slot(Slot.STATE_NAME_KEY, stateName));
    });

    return slots;
  }

  // Searches for template references inside the activity and replaces them with the actual text coming from the LG backend
  public static injectResponses(
    activity: IActivity,
    templateReferences: Map<string, string>,
  ): void {
    const injectors: IActivityInjector[] = [
      textInjector,
      speakInjector,
      suggestedActionsInjector,
    ];

    injectors.forEach(injector => injector(activity, templateReferences));
  }
}

// Not implemented
export class Slot {
  public static readonly STATE_NAME_KEY = 'GetStateName';
  constructor(public readonly key: string, public value: PrimitiveType) {}
}

//  ----------------------------------------- LG API -----------------------------------------

class Utilities {
  public static convertLGValueToString(value: ILGValue): string {
    switch (value.valueType) {
      case 0:
        return value.stringValues[0];
      case 1:
        return value.intValues[0].toString();
      case 2:
        return value.floatValues[0].toString();
      case 3:
        return value.booleanValues[0].toString();
      case 4:
        return value.dateTimeValues[0].toString();
      default:
        //@TODO
        throw new Error('Internal Error');
    }
  }
  public static convertSlotToLGValue(slot: Slot): ILGValue {
    const value = slot.value;

    if (isString(value)) {
      return {
        stringValues: [value],
        valueType: 0,
      };
    } else if (isNumber(value)) {
      if (isInteger(value)) {
        return {
          intValues: [value],
          valueType: 1,
        };
      } else {
        return {
          intValues: [value],
          valueType: 2,
        };
      }
    } else if (isBoolean(value)) {
      return {
        booleanValues: [value],
        valueType: 3,
      };
    } else if (isDate(value)) {
      return {
        dateTimeValues: [value.toISOString()],
        valueType: 3,
      };
    }

    // @TODO
    throw new Error('');
  }
}

interface ILGValue {
  valueType: 0 | 1 | 2 | 3 | 4;
  stringValues?: string[]; // valueType -> 0
  intValues?: number[]; // valueType -> 1
  // @TODO
  floatValues?: number[]; // valueType -> 2
  booleanValues?: boolean[]; // valueType -> 3
  dateTimeValues?: string[]; // valueType -> 4
}

interface ILGRequest {
  scenario: string;
  locale: string;
  slots: { [key: string]: ILGValue };
}

class LGRequestBuilder {
  private locale: string;
  private scenario: string;
  private slots: Slot[];

  public setSlots(slots: Slot[]): LGRequestBuilder {
    this.slots = slots;

    return this;
  }

  public setLocale(locale: string): LGRequestBuilder {
    this.locale = locale;

    return this;
  }

  public setScenario(scenario: string): LGRequestBuilder {
    this.scenario = scenario;

    return this;
  }

  public build(): ILGRequest {
    const slotsJSON: { [key: string]: ILGValue } = this.slots.reduce(
      (acc, slot) => {
        const lgValue = Utilities.convertSlotToLGValue(slot);
        acc[slot.key] = lgValue;
        return acc;
      },
      {},
    );

    return {
      locale: this.locale,
      scenario: this.scenario,
      slots: slotsJSON,
    };
  }
}

interface ILGResponse {
  outputs: { [key: string]: ILGValue };
}

class LGAPI {
  private readonly URL = 'https://lg-cris-dev.westus2.cloudapp.azure.com/v1/lg';
  constructor(
    private readonly lgEndpoint: LanguageGenerationEndpoint,
    private readonly lgOptions: LanguageGenerationOptions,
  ) {}

  public async fetch(lgRequest: ILGRequest): Promise<ILGResponse> {
    return await request({
      url: this.URL,
      method: 'POST',
      headers: { Authorization: this.lgEndpoint.endpointKey },
      body: {
        ...lgRequest,
      },
      json: true,
    });
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
      if (val !== comparedVal) {
        throw new Error(`    ${val} isn't ${comparedVal}`);
      }
    },
    toEqual: comparedVal => {
      if (val !== comparedVal) {
        throw new Error(`    ${val} doesn't equal ${comparedVal}`);
      }
    },
    toBeTruthy: () => {
      if (val !== true) {
        throw new Error(`    ${val} isn't truthy`);
      }
    },
    toBeFalsy: () => {
      if (val !== false) {
        throw new Error(`    ${val} isn't falsy`);
      }
    },
  };
};

describe('PatternRecognizer', () => {
  it('should extract all template references', () => {
    const templateReferences = PatternRecognizer.extractPatterns(
      '[sayGoodMorning]',
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
      '[sayGoodMorning]',
      templateReferences,
    );

    expect(newUtterance).toEqual('Hello');

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

class CardAction implements ICardAction {
  public type: string;
  public title: string;
  public image?: string;
  public text?: string;
  public displayText?: string;
  public value: any;
}

class SuggestedActions implements ISuggestedActions {
  public to: string[];
  public actions: ICardAction[];
}

class Activity implements IActivity {
  public type: string;
  public id?: string;
  public timestamp?: Date;
  public localTimestamp?: Date;
  public serviceUrl: string;
  public channelId: string;
  public from: import('../../botframework-schema/src').ChannelAccount;
  public conversation: import('../../botframework-schema/src').ConversationAccount;
  public recipient: import('../../botframework-schema/src').ChannelAccount;
  public textFormat?: string;
  public attachmentLayout?: string;
  public membersAdded?: import('../../botframework-schema/src').ChannelAccount[];
  public membersRemoved?: import('../../botframework-schema/src').ChannelAccount[];
  public reactionsAdded?: import('../../botframework-schema/src').MessageReaction[];
  public reactionsRemoved?: import('../../botframework-schema/src').MessageReaction[];
  public topicName?: string;
  public historyDisclosed?: boolean;
  public locale?: string;
  public text: string;
  public speak?: string;
  public inputHint?: string;
  public summary?: string;
  public suggestedActions?: import('../../botframework-schema/src').SuggestedActions;
  public attachments?: import('../../botframework-schema/src').Attachment[];
  public entities?: import('../../botframework-schema/src').Entity[];
  public channelData?: any;
  public action?: string;
  public replyToId?: string;
  public label: string;
  public valueType: string;
  public value?: any;
  public name?: string;
  public relatesTo?: import('../../botframework-schema/src').ConversationReference;
  public code?: string;
  public expiration?: Date;
  public importance?: string;
  public deliveryMode?: string;
  public textHighlights?: import('../../botframework-schema/src').TextHighlight[];
}

describe('ActivityUtilities', () => {
  const activity = new Activity();
  activity.text = '[sayHello], John! [welcomePhrase] to the new office.';
  activity.speak =
    '[sayGoodBye], John! [thankingPhrase] for your time, [scheduleMeeting].';

  activity.suggestedActions = new SuggestedActions();

  const cardAction = new CardAction();
  cardAction.text = '[sayGoodAfternoon]';
  cardAction.displayText = '[sayGoodNight]';

  activity.suggestedActions.actions = [cardAction];

  it('should extract all the template references from the given activity and use them to construct the slots array', () => {
    const entitiesMap = new Map().set('name', 'John').set('age', 12);

    const slots = ActivityUtilities.extractSlots(activity, entitiesMap);

    expect(slots.length).toBe(7);
    expect(
      slots.every(
        slot =>
          !isEmpty(slot.stateName) &&
          slot.entities.has('name') &&
          slot.entities.has('age'),
      ),
    ).toBeTruthy();
  });

  it('should inject the template resolutions in their respective references in the activity', () => {
    const responsesMap = new Map([
      ['sayHello', 'hello'],
      ['welcomePhrase', 'welcome'],
      ['sayGoodBye', 'bye'],
      ['thankingPhrase', 'thanks'],
      ['scheduleMeeting', `let's have a meeting`],
      ['sayGoodAfternoon', 'good afternoon'],
      ['sayGoodNight', 'good night'],
    ]);

    ActivityUtilities.injectResponses(activity, responsesMap);

    expect(activity.text).toEqual('hello, John! welcome to the new office.');
    expect(activity.speak).toEqual(
      "bye, John! thanks for your time, let's have a meeting.",
    );
    expect(activity.suggestedActions.actions[0].text).toEqual('good afternoon');
    expect(activity.suggestedActions.actions[0].displayText).toEqual(
      'good night',
    );
  });
});

describe('LanguageGenerationResolver', () => {
  it('', () => {
    const resolver = new LanguageGenerationResolver(
      new LanguageGenerationEndpoint('qw', 'rt', 'yu'),
      new LanguageGenerationOptions(),
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
