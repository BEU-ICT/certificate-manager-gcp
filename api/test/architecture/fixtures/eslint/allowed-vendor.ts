import { Firestore } from '@google-cloud/firestore';
import { Pool } from 'pg';

export const db = [Firestore, Pool];
