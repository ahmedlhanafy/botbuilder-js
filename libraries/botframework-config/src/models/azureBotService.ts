/**
 * Copyright(c) Microsoft Corporation.All rights reserved.
 * Licensed under the MIT License.
 */
import { IAzureBotService, ServiceTypes } from '../schema';
import { ConnectedService } from './connectedService';

export class AzureBotService extends ConnectedService implements IAzureBotService {
    public readonly type = ServiceTypes.AzureBotService;
    public tenantId = '';
    public subscriptionId = '';
    public resourceGroup = '';

    constructor(source: IAzureBotService = {} as IAzureBotService) {
        super(source);
        const { tenantId = '', subscriptionId = '', resourceGroup = '' } = source;
        Object.assign(this, { tenantId, subscriptionId, resourceGroup });
    }

    public toJSON(): IAzureBotService {
        const { id, name, tenantId, subscriptionId, resourceGroup } = this;
        return { type: ServiceTypes.AzureBotService, id, name, tenantId, subscriptionId, resourceGroup };
    }

    // encrypt keys in service
    public encrypt(secret: string, iv?: string): void {

    }

    // decrypt keys in service
    public decrypt(secret: string, iv?: string): void {

    }
}
