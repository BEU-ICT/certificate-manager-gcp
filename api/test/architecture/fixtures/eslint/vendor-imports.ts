import { initializeApp } from 'firebase-admin/app';
import { Storage } from '@google-cloud/storage';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import nodemailer from 'nodemailer';
import { Pool } from 'pg';
import { S3Client } from '@aws-sdk/client-s3';
import admin from 'firebase-admin';

export const all = [initializeApp, Storage, google, GoogleAuth, nodemailer, Pool, S3Client, admin];
