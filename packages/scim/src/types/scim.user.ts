import type { ScimCommonAttributes } from './scim.meta.js';

/** RFC 7643 §4.1.2: complex `name` attribute. */
export interface ScimUserName {
  formatted?: string;
  familyName?: string;
  givenName?: string;
  middleName?: string;
  honorificPrefix?: string;
  honorificSuffix?: string;
}

/** Generic multi-valued attribute shape (email, phone, IM, photo, address, etc.). */
export interface ScimMultiValuedAttribute<TValue = string> {
  value: TValue;
  display?: string;
  type?: string;
  primary?: boolean;
}

/** RFC 7643 §4.1.2: postal address. */
export interface ScimAddress {
  formatted?: string;
  streetAddress?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  type?: string;
  primary?: boolean;
}

/** Group membership reference embedded in a User. */
export interface ScimUserGroupRef {
  value: string;
  $ref?: string;
  display?: string;
  type?: 'direct' | 'indirect';
}

/** RFC 7643 §4.3: Enterprise User extension. */
export interface ScimEnterpriseUser {
  employeeNumber?: string;
  costCenter?: string;
  organization?: string;
  division?: string;
  department?: string;
  manager?: {
    value?: string;
    $ref?: string;
    displayName?: string;
  };
}

/** RFC 7643 §4.1: User resource. */
export interface ScimUser extends ScimCommonAttributes {
  userName: string;
  name?: ScimUserName;
  displayName?: string;
  nickName?: string;
  profileUrl?: string;
  title?: string;
  userType?: string;
  preferredLanguage?: string;
  locale?: string;
  timezone?: string;
  active?: boolean;
  password?: string;
  emails?: ScimMultiValuedAttribute[];
  phoneNumbers?: ScimMultiValuedAttribute[];
  ims?: ScimMultiValuedAttribute[];
  photos?: ScimMultiValuedAttribute[];
  addresses?: ScimAddress[];
  groups?: ScimUserGroupRef[];
  entitlements?: ScimMultiValuedAttribute[];
  roles?: ScimMultiValuedAttribute[];
  x509Certificates?: ScimMultiValuedAttribute[];
  /** EnterpriseUser extension keyed by its schema URI. */
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'?: ScimEnterpriseUser;
}
