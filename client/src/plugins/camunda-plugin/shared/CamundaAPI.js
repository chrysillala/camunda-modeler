/**
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH
 * under one or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information regarding copyright
 * ownership.
 *
 * Camunda licenses this file to you under the MIT; you may not use this file
 * except in compliance with the MIT License.
 */

import AuthTypes from './AuthTypes';

import debug from 'debug';

const FETCH_TIMEOUT = 5000;

const log = debug('CamundaAPI');


export default class CamundaAPI {

  constructor(endpoint) {

    this.baseUrl = normalizeBaseURL(endpoint.url);

    this.authentication = this.getAuthentication(endpoint);
  }

  async deployDiagram(diagram, deployment) {
    const {
      name,
      tenantId
    } = deployment;

    const form = new FormData();

    form.append('deployment-name', name);
    form.append('deployment-source', 'Camunda Modeler');
    form.append('deploy-changed-only', 'true');

    if (tenantId) {
      form.append('tenant-id', tenantId);
    }

    const diagramName = diagram.name;

    const blob = new Blob([ diagram.contents ], { type: 'text/xml' });

    form.append(diagramName, blob, diagramName);

    const response = await this.fetch('/deployment/create', {
      method: 'POST',
      body: form
    });

    if (response.ok) {

      const {
        id,
        deployedProcessDefinitions
      } = await response.json();

      return {
        id,
        deployedProcessDefinitions,
        deployedProcessDefinition: Object.values(deployedProcessDefinitions || {})[0]
      };
    }

    const body = await this.parse(response);

    throw new DeploymentError(response, body);
  }

  async checkConnection() {

    const response = await this.fetch('/deployment?maxResults=0');

    if (response.ok) {
      return;
    }

    throw new ConnectionError(response);
  }

  getAuthentication(endpoint) {

    const {
      authType,
      username,
      password,
      token
    } = endpoint;

    switch (authType) {
    case AuthTypes.basic:
      return {
        username,
        password
      };
    case AuthTypes.bearer:
      return {
        token
      };
    }
  }

  getHeaders() {
    const headers = {
      accept: 'application/json'
    };

    if (this.authentication) {
      headers.authorization = this.getAuthHeader(this.authentication);
    }

    return headers;
  }

  getAuthHeader(endpoint) {

    const {
      token,
      username,
      password
    } = endpoint;

    if (token) {
      return `Bearer ${token}`;
    }

    if (username && password) {
      const credentials = window.btoa(`${username}:${password}`);

      return `Basic ${credentials}`;
    }

    throw new Error('Unknown auth options.');
  }

  async fetch(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = this.getHeaders();

    try {
      const signal = options.signal || this.setupTimeoutSignal();

      return await fetch(url, {
        ...options,
        headers,
        signal
      });
    } catch (error) {
      log('failed to fetch', error);

      return {
        url,
        json: () => {
          return {};
        }
      };
    }
  }

  setupTimeoutSignal(timeout = FETCH_TIMEOUT) {
    const controller = new AbortController();

    setTimeout(() => controller.abort(), timeout);

    return controller.signal;
  }

  async parse(response) {
    try {
      const json = await response.json();

      return json;
    } catch (error) {
      return {};
    }
  }
}

const NO_INTERNET_CONNECTION = 'NO_INTERNET_CONNECTION';
const CONNECTION_FAILED = 'CONNECTION_FAILED';
const DIAGRAM_PARSE_ERROR = 'DIAGRAM_PARSE_ERROR';
const UNAUTHORIZED = 'UNAUTHORIZED';
const FORBIDDEN = 'FORBIDDEN';
const NOT_FOUND = 'NOT_FOUND';
const INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR';
const UNAVAILABLE_ERROR = 'UNAVAILABLE_ERROR';

export const ApiErrors = {
  NO_INTERNET_CONNECTION,
  CONNECTION_FAILED,
  DIAGRAM_PARSE_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  INTERNAL_SERVER_ERROR,
  UNAVAILABLE_ERROR
};

export const ApiErrorMessages = {
  [ NO_INTERNET_CONNECTION ]: 'Could not establish a network connection. Most likely your machine is not online right now',
  [ CONNECTION_FAILED ]: 'Could not connect to the server. Did you run the engine?',
  [ DIAGRAM_PARSE_ERROR ]: 'Server could not parse the diagram. Please check log for errors.',
  [ UNAUTHORIZED ]: 'Authentication failed. Please check your credentials.',
  [ FORBIDDEN ]: 'This user is not permitted to deploy. Please use different credentials or get this user enabled to deploy.',
  [ NOT_FOUND ]: 'Could not find the Camunda endpoint. Please check the URL and make sure Camunda is running.',
  [ INTERNAL_SERVER_ERROR ]: 'Camunda is reporting an error. Please check the server status.',
  [ UNAVAILABLE_ERROR ]: 'Camunda is reporting an error. Please check the server status.'
};

export class ConnectionError extends Error {

  constructor(response) {
    super('Connection failed');

    this.code = (
      getResponseErrorCode(response) ||
      getNetworkErrorCode(response)
    );

    this.details = ApiErrorMessages[this.code];
  }
}


export class DeploymentError extends Error {

  constructor(response, body) {
    super('Deployment failed');

    this.code = (
      getCamundaErrorCode(response, body) ||
      getResponseErrorCode(response) ||
      getNetworkErrorCode(response)
    );

    this.details = ApiErrorMessages[this.code];

    this.problems = body && body.message;
  }
}


// helpers ///////////////

function getNetworkErrorCode(response) {
  if (isLocalhost(response.url) || isOnline()) {
    return CONNECTION_FAILED;
  }

  return NO_INTERNET_CONNECTION;
}

function getResponseErrorCode(response) {
  switch (response.status) {
  case 401:
    return UNAUTHORIZED;
  case 403:
    return FORBIDDEN;
  case 404:
    return NOT_FOUND;
  case 500:
    return INTERNAL_SERVER_ERROR;
  case 503:
    return UNAVAILABLE_ERROR;
  }
}

function getCamundaErrorCode(response, body) {

  const PARSE_ERROR_PREFIX = 'ENGINE-09005 Could not parse BPMN process.';

  if (body && body.message && body.message.startsWith(PARSE_ERROR_PREFIX)) {
    return DIAGRAM_PARSE_ERROR;
  }
}

function isLocalhost(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)/.test(url);
}

function isOnline() {
  return window.navigator.onLine;
}

function normalizeBaseURL(url) {
  return url.replace(/\/deployment\/create\/?/, '');
}