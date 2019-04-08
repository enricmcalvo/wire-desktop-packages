/*
 * Wire
 * Copyright (C) 2019 Wire Swiss GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see http://www.gnu.org/licenses/.
 */

import path from 'path';

import S3 from 'aws-sdk/clients/s3';
import fs from 'fs-extra';

import {FindResult, find, logDry} from './deploy-utils';

interface S3DeployerOptions {
  accessKeyId: string;
  dryRun?: boolean;
  secretAccessKey: string;
}

interface DeleteOptions {
  bucket: string;
  s3Path: string;
}

interface S3UploadOptions {
  bucket: string;
  filePath: string;
  s3Path: string;
}

interface S3CopyOptions {
  bucket: string;
  s3FromPath: string;
  s3ToPath: string;
}

class S3Deployer {
  private readonly options: Required<S3DeployerOptions>;
  private readonly S3Instance: S3;

  constructor(options: S3DeployerOptions) {
    this.options = {
      dryRun: false,
      ...options,
    };
    this.S3Instance = new S3({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    });
  }

  async findUploadFiles(platform: string, basePath: string, version: string): Promise<FindResult[]> {
    if (platform.includes('linux')) {
      const appImage = await find('*.AppImage', {cwd: basePath});
      const debImage = await find('*.deb', {cwd: basePath});
      const repositoryFiles = [
        `debian/pool/main/${debImage.fileName}`,
        'debian/dists/stable/Contents-amd64',
        'debian/dists/stable/Contents-amd64.bz2',
        'debian/dists/stable/Contents-amd64.gz',
        'debian/dists/stable/InRelease',
        'debian/dists/stable/Release',
        'debian/dists/stable/Release.gpg',
        'debian/dists/stable/main/binary-amd64/Packages',
        'debian/dists/stable/main/binary-amd64/Packages.bz2',
        'debian/dists/stable/main/binary-amd64/Packages.gz',
      ].map(fileName => ({fileName, filePath: path.join(basePath, fileName)}));

      return [...repositoryFiles, appImage, debImage];
    } else if (platform.includes('windows')) {
      const setupExe = await find('*-Setup.exe', {cwd: basePath});
      const nupkgFile = await find('*-full.nupkg', {cwd: basePath});
      const releasesFile = await find('RELEASES', {cwd: basePath});

      const [, appShortName] = new RegExp('(.+)-[\\d.]+-full\\.nupkg').exec(nupkgFile.fileName) || ['', ''];

      if (!appShortName) {
        throw new Error('App short name not found');
      }

      const setupExeRenamed = {...setupExe, fileName: `${appShortName}-${version}.exe`};
      const releasesRenamed = {...releasesFile, fileName: `${appShortName}-${version}-RELEASES`};

      return [nupkgFile, releasesRenamed, setupExeRenamed];
    } else if (platform.includes('macos')) {
      const setupPkg = await find('*.pkg', {cwd: basePath});
      return [setupPkg];
    } else {
      throw new Error(`Invalid platform "${platform}"`);
    }
  }

  async uploadToS3(uploadOptions: S3UploadOptions): Promise<void> {
    const {bucket, filePath, s3Path} = uploadOptions;

    const lstat = await fs.lstat(filePath);

    if (!lstat.isFile()) {
      throw new Error(`File "${filePath} not found`);
    }

    const file = fs.createReadStream(filePath);

    const uploadConfig = {
      ACL: 'public-read',
      Body: file,
      Bucket: bucket,
      Key: s3Path,
    };

    if (this.options.dryRun) {
      logDry('uploadToS3', uploadConfig);
      return;
    }

    await this.S3Instance.upload(uploadConfig).promise();
  }

  async deleteFromS3(deleteOptions: DeleteOptions): Promise<void> {
    const deleteConfig = {
      Bucket: deleteOptions.bucket,
      Key: deleteOptions.s3Path,
    };

    if (this.options.dryRun) {
      logDry('deleteFromS3', deleteConfig);
      return;
    }

    await this.S3Instance.deleteObject(deleteConfig).promise();
  }

  async copyOnS3(copyOptions: S3CopyOptions): Promise<void> {
    const copyConfig = {
      ACL: 'public-read',
      Bucket: copyOptions.bucket,
      CopySource: copyOptions.s3FromPath,
      Key: copyOptions.s3ToPath,
    };

    if (this.options.dryRun) {
      logDry('copyOnS3', copyConfig);
      return;
    }

    await this.S3Instance.copyObject(copyConfig).promise();
  }
}

export {S3Deployer, DeleteOptions, S3UploadOptions, S3CopyOptions};