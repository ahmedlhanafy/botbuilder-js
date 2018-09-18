/**
 * @module botbuilder-ai
 *
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { Activity } from 'botbuilder';
import { isBoolean, isDate, isEmpty, isInteger, isNil, isNumber, isString, replace } from 'lodash';
import * as request from 'request-promise-native';

//  ######################################### EXPORTED API #########################################

export type PrimitiveType = string | number | boolean | Date;

export interface LanguageGenerationApplication {
  applicationId: string;

  /** (Optional) Azure region */
  azureRegion?: string;

  endpointKey: string;
}

export interface LanguageGenerationOptions {}

export class LanguageGenerationResolver {
  private lgApi: LGAPI;
  constructor(
    private application: LanguageGenerationApplication,
    private options: LanguageGenerationOptions,
  ) {
    this.validateApplicationInputs();
    this.lgApi = new LGAPI(application, options);
  }

  public async resolve(activity: Activity, entities?: Map<string, PrimitiveType>): Promise<void> {
    if (isNil(activity)) {
      throw new Error("Activity can't be null or undefined");
    }

    await this.lgApi.authenticate();

    const slotsBuilder = new SlotsBuilder(activity, entities);
    const activityInjector = new ActivityInjector(activity);

    const [templateReferences, entitiesSlots] = slotsBuilder.build();

    const requestsPromises = templateReferences
      .map(templateReference =>
        new LGRequestBuilder()
          .setScenario(this.application.applicationId)
          .setLocale(activity.locale)
          .setSlots(entitiesSlots)
          .setTemplateId(templateReference)
          .build(),
      )
      .map(this.lgApi.fetch);

    const responses = await Promise.all(requestsPromises);
    
    const templateResolutions = Utilities.transformLGResponsestoMap(responses);

    this.validateResponses(templateReferences, templateResolutions);

    activityInjector.injectTemplateReferences(templateResolutions);
  }

  private validateResponses(
    templateReferences: string[],
    templateResolutions: Map<string, string>,
  ): void {
    templateReferences.forEach(templateReference => {
      if (!templateResolutions.has(templateReference)) {
        //@TODO
        throw new Error();
      }
    });
  }

  private validateApplicationInputs(): void {
    if (isEmpty(this.application.applicationId)) {
      //@TODO
      throw new Error(``);
    }

    if (isEmpty(this.application.endpointKey)) {
      //@TODO
      throw new Error(``);
    }
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

const suggestedActionsInspector: IActivityInspector = (activity: Activity): string[] => {
  if (activity.suggestedActions && activity.suggestedActions.actions) {
    return activity.suggestedActions.actions.reduce((acc, action) => {
      if (action.text) {
        acc = [...acc, ...acc.concat(PatternRecognizer.extractPatterns(action.text))];
      }

      if (action.displayText) {
        acc = [...acc, ...acc.concat(PatternRecognizer.extractPatterns(action.displayText))];
      }

      return acc;
    }, []);
  }

  return [];
};

/**
 * @private
 */
export class ActivityInspector {
  private readonly inspectors = [textInspector, speakInspector, suggestedActionsInspector];

  constructor(private readonly activity: Activity) {}

  // Searches for template references inside the activity and constructs slots
  public extractTemplateReferences(): string[] {
    // Utilize activity inspectors to extract the template references
    const stateNames = this.inspectors
      .map(inspector => inspector(this.activity))
      .reduce((acc, current) => [...acc, ...current], []);

    return [...new Set(stateNames).values()];
  }
}

//  ----------------------------------------- Activity Injectors -----------------------------------------
type IActivityInjector = (activity: Activity, templateResolutions: Map<string, string>) => void;

const textInjector: IActivityInjector = (
  activity: Activity,
  templateResolutions: Map<string, string>,
): void => {
  const text = activity.text;
  if (text) {
    activity.text = PatternRecognizer.replacePatterns(text, templateResolutions);
  }
};

const speakInjector: IActivityInjector = (
  activity: Activity,
  templateResolutions: Map<string, string>,
): void => {
  const speak = activity.speak;
  if (speak) {
    activity.speak = PatternRecognizer.replacePatterns(speak, templateResolutions);
  }
};

const suggestedActionsInjector: IActivityInjector = (
  activity: Activity,
  templateResolutions: Map<string, string>,
): void => {
  if (activity.suggestedActions && activity.suggestedActions.actions) {
    activity.suggestedActions.actions.forEach(action => {
      if (action.text) {
        action.text = PatternRecognizer.replacePatterns(action.text, templateResolutions);
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

/**
 * @private
 */
export class ActivityInjector {
  private readonly injectors: IActivityInjector[] = [
    textInjector,
    speakInjector,
    suggestedActionsInjector,
  ];
  constructor(private readonly activity: Activity) {}
  // Searches for template references inside the activity and replaces them with the actual text coming from the LG backend
  public injectTemplateReferences(templateReferences: Map<string, string>): void {
    this.injectors.forEach(injector => injector(this.activity, templateReferences));
  }
}

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
    templateResolutions: Map<string, string>
  ): string {
    let modifiedText = originalText;
    templateResolutions.forEach((stateResolution, templateReference) => {
      modifiedText = replace(
        modifiedText,
        PatternRecognizer.constructTemplateReference(templateReference),
        stateResolution
      );
    });

    return modifiedText;
  }

  private static constructTemplateReference = (text: string) => `[${text}]`;
}

/**
 * @private
 */
export class SlotsBuilder {
  constructor(
    private readonly activity: Activity,
    private readonly entities?: Map<string, PrimitiveType>
  ) {}

  public build(): [string[], Slot[]] {
    const activityInspector = new ActivityInspector(this.activity);

    const templateReferences = activityInspector.extractTemplateReferences();

    const entitiesSlots = !isNil(this.entities) ? this.convertEntitiesToSlots(this.entities) : [];

    return [templateReferences, entitiesSlots];
  }

  private convertEntitiesToSlots(entities: Map<string, PrimitiveType>): Slot[] {
    const slots: Slot[] = [];
    entities.forEach((value, key) => slots.push(new Slot(key, value)));

    return slots;
  }
}

/**
 * @private
 */
export class Slot {
  public static readonly STATE_NAME_KEY = 'GetStateName';
  constructor(public readonly key: string, public value: PrimitiveType) {}
}

//  ----------------------------------------- LG API -----------------------------------------
/**
 * @private
 */
export class Utilities {
  public static convertLGValueToString(value: LGValue): string {
    switch (value.ValueType) {
      case 0:
        return value.StringValues[0];
      // @TODO The return type should be strings only
      case 1:
        return value.IntValues[0].toString();
      case 2:
        return value.FloatValues[0].toString();
      case 3:
        return value.BooleanValues[0].toString();
      case 4:
        return value.DateTimeValues[0].toString();
      default:
        //@TODO
        throw new Error('Internal Error');
    }
  }

  public static convertSlotToLGValue(slot: Slot): LGValue {
    const value = slot.value;

    if (isString(value)) {
      return {
        StringValues: [value],
        ValueType: 0
      };
    } else if (isNumber(value)) {
      if (isInteger(value)) {
        return {
          IntValues: [value],
          ValueType: 1
        };
      } else {
        return {
          FloatValues: [value],
          ValueType: 2
        };
      }
    } else if (isBoolean(value)) {
      return {
        BooleanValues: [value],
        ValueType: 3
      };
    } else if (isDate(value)) {
      return {
        DateTimeValues: [value.toISOString()],
        ValueType: 4
      };
    }
  }

  public static extractTemplateReferenceAndResolution(res: LGResponse): [string, string] {
    if (isNil(res.Outputs) || isNil(Object.keys(res.Outputs)[0])) {
      return [null, null];
    }

    const templateReference = res.templateId;
    const templateResolution = res.Outputs.DisplayText;

    const templateResolutionStr = Utilities.convertLGValueToString(templateResolution);

    return [templateReference, templateResolutionStr];
  }

  public static transformLGResponsestoMap(responses: LGResponse[]): Map<string, string> {
    const templateResolutions = new Map<string, string>();

    responses
      .map(Utilities.extractTemplateReferenceAndResolution)
      .filter(
        ([templateReference, templateResolution]) =>
          !isNil(templateReference) && !isNil(templateResolution),
      )
      .forEach(([templateReference, templateResolution]) =>
        templateResolutions.set(templateReference, templateResolution)
      );

    return templateResolutions;
  }
}

/**
 * @private
 */
export interface LGValue {
  ValueType: 0 | 1 | 2 | 3 | 4;
  StringValues?: string[]; // valueType -> 0
  IntValues?: number[]; // valueType -> 1
  // @TODO
  FloatValues?: number[]; // valueType -> 2
  BooleanValues?: boolean[]; // valueType -> 3
  DateTimeValues?: string[]; // valueType -> 4
}

/**
 * @private
 */
export interface LGRequest {
  scenario: string;
  locale: string;
  slots: { [key: string]: LGValue };
  templateId: string;
}

class LGRequestBuilder {
  private locale: string;
  private scenario: string;
  private slots: Slot[];
  private templateId: string;

  public setSlots(slots: Slot[]): LGRequestBuilder {
    this.slots = slots;

    return this;
  }

  public setLocale(locale: string): LGRequestBuilder {
    this.locale = locale;

    return this;
  }

  public setTemplateId(templateId: string): LGRequestBuilder {
    this.templateId = templateId;

    return this;
  }

  public setScenario(scenario: string): LGRequestBuilder {
    this.scenario = scenario;

    return this;
  }

  public build(): LGRequest {
    const slotsJSON: { [key: string]: LGValue } = this.slots.reduce((acc, slot) => {
      const lgValue = Utilities.convertSlotToLGValue(slot);
      acc[slot.key] = lgValue;
      return acc;
    },                                                              {});

    return {
      locale: this.locale,
      scenario: this.scenario,
      slots: slotsJSON,
      templateId: this.templateId
    };
  }
}

/**
 * @private
 */
export interface LGResponse {
  Outputs: { DisplayText: LGValue };
  templateId: string;
}

/**
 * @private
 */
export class LGAPI {
  public static readonly BASE_URL = 'https://platform.bing.com/speechdx/lg-dev/';
  public static readonly RESOURCE_URL = 'v1/lg';

  public static readonly ISSUE_TOKEN_URL =
    'https://wuppe.api.cognitive.microsoft.com/sts/v1.0/issueToken';

  private token = null;

  constructor(
    private readonly application: LanguageGenerationApplication,
    private readonly options: LanguageGenerationOptions
  ) {}

  public async authenticate(): Promise<void> {
    try {
      this.token = await request({
        url: LGAPI.ISSUE_TOKEN_URL,
        method: 'POST',
        headers: {
          'OCP-APIM-SUBSCRIPTION-KEY': this.application.endpointKey
        },
        json: true
      });
    } catch (e) {
      throw new Error(e.error.message);
    }
  }

  public fetch = async (lgRequest: LGRequest): Promise<LGResponse> => {
    try {
      const response = await request({
        url: LGAPI.BASE_URL + LGAPI.RESOURCE_URL,
        method: 'POST',
        //@todo
        headers: {
          Authorization: `Bearer - ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(lgRequest)
      });

      return { ...JSON.parse(response), templateId: lgRequest.templateId };
    } catch (e) {
      console.log(e);
      switch (e.statusCode) {
        case 401:
        case 501:
          throw new Error(e.error);
        default:
          //@TODO
          throw new Error('Internal Error');
      }
    }
  }
}
